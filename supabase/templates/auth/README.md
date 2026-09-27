# Supabase auth email templates

Branded HTML for the auth emails Cuenvia sends. Supabase hosts these, so they are pasted into the dashboard rather than deployed with the app.

**Where:** Supabase → Authentication → Emails → Templates. Paste each file's full contents into the **Message body** (source view) and set the **Subject**.

| Template in Supabase | File | Subject |
| --- | --- | --- |
| Confirm signup | `confirm-signup.html` | Confirm your Cuenvia account |
| Reset password | `reset-password.html` | Reset your Cuenvia password |
| Change email address | `change-email.html` | Confirm your new Cuenvia email |

Cuenvia doesn't use magic links, invites, or reauthentication, so those templates can stay as they are.

Notes:
- `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .NewEmail }}` are Supabase template variables; keep them exactly as written.
- The logo loads from `https://www.cuenvia.com/icon-192.png` (PNG, because many email clients block SVG).
- Custom SMTP (SES, sender `noreply@cuenvia.com`) must be on for these to come from cuenvia.com.
- After Phase 3 (Supabase branching), paste the same templates into the dev branch too.
