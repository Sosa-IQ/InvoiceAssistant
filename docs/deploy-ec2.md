# Deploy Cuenvia API on a fresh AWS EC2 (t4g.micro, Amazon Linux 2023 or Ubuntu 22.04/24.04)

This runbook assumes:

- Frontend on **Vercel**
- API on **EC2 t4g.micro (arm64)**
- DB/Auth on **Supabase**
- Email **SES**, payments **Stripe**

Repo paths are relative to the project root.

---

## 0. Before you touch the server

### 0.1 Domain pieces (recommended)

| Host | Points to |
|---|---|
| `api.yourdomain.com` | EC2 Elastic IP (A record) |
| `app.yourdomain.com` (or apex) | Vercel (their docs / CNAME) |

You can start with the raw Elastic IP and HTTP only for a smoke test, then add HTTPS + domain.

### 0.2 AWS console checklist

1. **EC2 → Instances** → your new t4g.micro is **running**
2. **Elastic IP** → Allocate → Associate to this instance (survives stop/start)
3. **Security group** inbound:
   - **22** TCP from *your IP only* (SSH)
   - **80** TCP from `0.0.0.0/0` (HTTP, for ACME + redirect)
   - **443** TCP from `0.0.0.0/0` (HTTPS)
   - Do **not** open 8000 publicly long-term (Caddy proxies to localhost)
4. Key pair: you already downloaded the `.pem`

### 0.3 Laptop: PEM permissions (macOS / Linux)

```bash
chmod 400 ~/Downloads/your-key.pem
```

Windows (PowerShell): keep the key private; use `ssh -i` in recent OpenSSH.

---

## 1. SSH into the instance (very start)

### 1.1 Find the public IP / DNS

EC2 → instance → **Public IPv4 address** (prefer the **Elastic IP**).

### 1.2 Amazon Linux 2023 (common default)

```bash
ssh -i ~/Downloads/your-key.pem ec2-user@YOUR_ELASTIC_IP
```

### 1.3 Ubuntu AMI

```bash
ssh -i ~/Downloads/your-key.pem ubuntu@YOUR_ELASTIC_IP
```

First connect: type `yes` to trust the host key.

If timeout: security group SSH not open to your current IP, or wrong IP/user.

---

## 2. Base OS setup (on the server)

### Amazon Linux 2023

```bash
sudo dnf update -y
sudo dnf install -y git docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
# re-login so docker group applies
exit
```

SSH back in, then:

```bash
docker version
# optional compose plugin
sudo dnf install -y docker-compose-plugin
```

### Ubuntu

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu
exit
# SSH back in
docker version
```

### Memory: add swap (important on 1 GB)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
free -h
```

---

## 3. Get the code on the server

### Option A — public GitHub clone (simplest)

```bash
cd ~
git clone https://github.com/Sosa-IQ/InvoiceAssistant.git
cd InvoiceAssistant
git checkout main
git pull
```

### Option B — private repo

Use a deploy key or `gh auth`, or copy with `scp` from your Mac:

```bash
# on your Mac, from the project parent directory
scp -i ~/Downloads/your-key.pem -r InvoiceAssistant ec2-user@YOUR_ELASTIC_IP:~/
```

---

## 4. API environment file (on the server)

```bash
cd ~/InvoiceAssistant/backend
cp .env.example .env
nano .env   # or vim
```

### Production-oriented values (edit to real secrets)

```dotenv
APP_ENVIRONMENT=production
LOG_LEVEL=INFO
FRONTEND_URL=https://app.yourdomain.com
DATA_DIR=/app/data

# Supabase (same project you use locally; use pooler if IPv4-only egress)
DATABASE_URL=postgresql+asyncpg://postgres.PROJECT:URLENCODED_PASSWORD@aws-1-REGION.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_JWT_SECRET=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=invoices

OPENAI_API_KEY=sk-...
SPEECHMATICS_API_KEY=   # if used

SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_USE_TLS=true
SMTP_USE_SSL=false
SMTP_FROM_EMAIL=invoices@yourdomain.com
SMTP_FROM_NAME=Cuenvia

# Stripe — start TEST mode on prod URL first, then switch to live
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_AI_PACK_PRICE_ID=price_...
STRIPE_VOICE_PACK_PRICE_ID=price_...
STRIPE_EXPECTED_LIVEMODE=false
BILLING_ENFORCEMENT_ENABLED=true

SENTRY_DSN=
```

Notes:

- `FRONTEND_URL` must be the **Vercel origin only** (no path), `https://...`
- Production + Stripe configured requires HTTPS `FRONTEND_URL` (enforced in settings)
- Prefer Supabase **session pooler** on IPv4-only EC2 (same lesson as local Mac mini)
- Never commit `.env`

Lock down permissions:

```bash
chmod 600 .env
```

---

## 5. Database migrations

Run once against prod Supabase (from the server, using the same `.env`):

```bash
cd ~/InvoiceAssistant/backend
docker build -t cuenvia-api .
docker run --rm --env-file .env cuenvia-api \
  alembic upgrade head
docker run --rm --env-file .env cuenvia-api \
  alembic current
# expect: 0012_invoice_status_lifecycle (or newer head)
```

---

## 6. Run the API container

```bash
cd ~/InvoiceAssistant/backend
docker rm -f cuenvia-api 2>/dev/null || true
docker run -d \
  --name cuenvia-api \
  --restart unless-stopped \
  --env-file .env \
  -p 127.0.0.1:8000:8000 \
  -v cuenvia_data:/app/data \
  cuenvia-api

docker ps
docker logs -f cuenvia-api
# Ctrl+C to stop following; container keeps running
```

Local health (on server):

```bash
curl -sS http://127.0.0.1:8000/health/live
curl -sS http://127.0.0.1:8000/health/ready
curl -sS http://127.0.0.1:8000/api/billing/plans
```

---

## 7. HTTPS reverse proxy (Caddy)

### Install Caddy (Amazon Linux 2023 — use official docs if package differs)

Ubuntu:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Amazon Linux: follow [Caddy install docs](https://caddyserver.com/docs/install) for your AMI, or run Caddy in Docker publishing 80/443.

### Configure

```bash
sudo cp ~/InvoiceAssistant/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Set your email + `api.yourdomain.com`. DNS **A record must already point** at the Elastic IP.

```bash
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo systemctl status caddy
```

Test:

```bash
curl -sS https://api.yourdomain.com/health/live
```

---

## 8. Vercel frontend

1. [vercel.com](https://vercel.com) → Import `Sosa-IQ/InvoiceAssistant`
2. **Root directory:** `frontend`
3. Framework: Vite
4. Environment variables:

| Name | Value |
|---|---|
| `VITE_API_URL` | `https://api.yourdomain.com` |
| `VITE_SUPABASE_URL` | your Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | anon key |

5. Deploy production domain `app.yourdomain.com` (Vercel DNS instructions)
6. Redeploy after env changes (Vite bakes env at **build** time)

---

## 9. Supabase Auth URLs

Supabase Dashboard → Authentication → URL configuration:

- Site URL: `https://app.yourdomain.com`
- Redirect URLs: include  
  `https://app.yourdomain.com/**`  
  and local `http://localhost:5173/**` if you still dev locally

---

## 10. Stripe webhook (test mode first)

1. Stripe Dashboard (test) → Developers → Webhooks → Add endpoint  
   `https://api.yourdomain.com/api/billing/webhook`
2. Events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
3. Copy signing secret `whsec_...` → server `backend/.env` as `STRIPE_WEBHOOK_SECRET`
4. Restart API:

```bash
docker restart cuenvia-api
```

5. Checkout test card `4242…` → confirm customer becomes Pro in app

When going live: live keys, `STRIPE_EXPECTED_LIVEMODE=true`, new live webhook secret, live price IDs.

---

## 11. SES / email

- From-address domain verified in SES
- Production access if still in sandbox (SES sandbox only mails verified addresses)
- Security group does not need special SMTP ports inbound (outbound 587 is enough)

---

## 12. Smoke test checklist

- [ ] `https://api.yourdomain.com/health/ready` → 200  
- [ ] `https://app.yourdomain.com` → Cuenvia landing  
- [ ] Sign up / login  
- [ ] Free: create/save invoice PDF  
- [ ] Free: AI generate → 402 + “View plans”  
- [ ] Pro checkout (test) → webhook → Pro features work  
- [ ] Email send on Pro (if SES allows)  

---

## 13. Day-2 ops (short)

```bash
# logs
docker logs --tail 200 cuenvia-api

# update app
cd ~/InvoiceAssistant && git pull
cd backend
docker build -t cuenvia-api .
docker rm -f cuenvia-api
docker run -d --name cuenvia-api --restart unless-stopped \
  --env-file .env -p 127.0.0.1:8000:8000 -v cuenvia_data:/app/data cuenvia-api

# migrations after pull (if new revisions)
docker run --rm --env-file .env cuenvia-api alembic upgrade head
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| SSH timeout | SG port 22 + your IP; instance running |
| `docker: permission denied` | re-login after `usermod -aG docker` |
| Container OOM / restart loop | `free -h`, swap, `docker logs`; reduce workers (already 1) |
| CORS errors in browser | `FRONTEND_URL` exact Vercel origin; redeploy API after change |
| WeasyPrint errors | rebuild image; ensure Dockerfile deps installed |
| DB connection errors | pooler URL, password URL-encoded, SG egress open |
| Stripe webhook 400 | `STRIPE_WEBHOOK_SECRET` matches endpoint; livemode flag |
| Ready 503 | migrations not applied; DATABASE_URL wrong |

---

## Security minimums

- SSH key only; no password SSH  
- SG: 22 locked to you; 8000 not public  
- `chmod 600` on `.env` and `.pem`  
- Prefer IMDSv2 on the instance  
- Rotate keys if PEM is ever shared or committed  
