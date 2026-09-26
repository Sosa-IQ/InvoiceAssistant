import { Link } from "react-router-dom"
import { PublicShell } from "@/components/PublicShell"
import { APP_NAME, APP_SUPPORT_EMAIL } from "@/lib/brand"

// Keep in sync with the providers the backend actually calls (see backend/app/services).
const PROCESSORS = [
  { name: "Supabase", purpose: "Sign-in, database, and stored invoice PDFs" },
  { name: "Amazon Web Services", purpose: "Hosting for our API, and sending invoice email (Amazon SES)" },
  { name: "Vercel", purpose: "Hosting for the website and app" },
  { name: "Cloudflare", purpose: "DNS, network protection, and bot checks on sign-up and log-in (Turnstile)" },
  { name: "Stripe", purpose: "Subscription and top-up payments. Card details go to Stripe; we never see or store them." },
  { name: "OpenAI", purpose: "AI invoice drafting, edits, and smart suggestions, only when you use those features" },
  { name: "Speechmatics", purpose: "Transcribing voice recordings, only when you use voice input" },
]

const linkClass = "font-bold text-foreground underline-offset-4 hover:underline"

export default function PrivacyPage() {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-black uppercase tracking-[0.14em] text-primary">Legal</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Privacy policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated September 26, 2026</p>
        <div className="mt-8 space-y-5 text-sm leading-7 text-muted-foreground">
          <p>
            {APP_NAME} is built for small businesses that expect their client and invoice data to stay private. This
            policy explains what we collect, who helps us process it, and the choices you have.
          </p>

          <h2 className="text-lg font-black text-foreground">Information we collect</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Account details: your email address and sign-in identifiers.</li>
            <li>
              Workspace content you enter: business profile, clients and their contact details, catalog items, invoices,
              uploaded invoice PDFs, and email templates.
            </li>
            <li>
              Invoice emails you send: recipient, CC, subject, message, and delivery status, so you can see your send
              history.
            </li>
            <li>Billing records: your plan, subscription status, and Stripe customer ID.</li>
            <li>Usage records: counts of AI tokens and voice seconds used, so we can apply plan limits.</li>
            <li>
              Technical logs: request times, status codes, and error details. We do not log invoice contents, email
              contents, or passwords.
            </li>
          </ul>

          <h2 className="text-lg font-black text-foreground">How we use information</h2>
          <p>
            We use your information to run {APP_NAME}: to sign you in, save and generate invoices, send the emails you
            ask us to send, run AI and voice features when you use them, bill subscriptions, enforce usage limits,
            prevent abuse, and keep the service reliable. We do not sell your personal data or your invoice contents,
            and we do not use them for advertising.
          </p>

          <h2 className="text-lg font-black text-foreground">AI and voice features</h2>
          <p>
            When you use AI drafting, AI edits, or smart suggestions, the relevant invoice text is sent to OpenAI to
            produce the result. When you use voice input, your recording is sent to Speechmatics for transcription. We
            do not keep the audio. These providers process the data to return results to us under their API terms. OpenAI
            does not use API data to train its models by default. If you do not use these features, your content is not
            sent to them.
          </p>

          <h2 className="text-lg font-black text-foreground">Service providers</h2>
          <p>We share data only with providers that help us run {APP_NAME}, and only for these purposes:</p>
          <ul className="list-disc space-y-2 pl-5">
            {PROCESSORS.map((processor) => (
              <li key={processor.name}>
                <span className="font-bold text-foreground">{processor.name}:</span> {processor.purpose}
              </li>
            ))}
          </ul>
          <p>
            We may also disclose information when the law requires it, or to protect the rights and safety of our users
            and the service.
          </p>

          <h2 className="text-lg font-black text-foreground">Cookies and browser storage</h2>
          <p>
            We do not use advertising or analytics trackers. Your browser stores your sign-in session, theme preference,
            and unsaved invoice drafts so the app works as expected. Cloudflare Turnstile runs a bot check on sign-up,
            log-in, and password reset.
          </p>

          <h2 className="text-lg font-black text-foreground">Retention and deletion</h2>
          <p>
            We keep your data while your account is active. You can delete your account at any time from{" "}
            <span className="font-bold text-foreground">Settings → Delete account</span>. Deletion immediately removes
            your workspace, invoices, clients, catalog, email history, and stored PDFs, and cancels any active
            subscription. Stripe keeps its own payment records as required for tax and accounting. Copies in provider logs
            or backups may persist for a limited time before they expire.
          </p>

          <h2 className="text-lg font-black text-foreground">Security</h2>
          <p>
            Data is encrypted in transit, and each account can only access its own records. We protect sign-up and log-in
            against automated abuse. No method of transmission or storage is perfectly secure, so please use a strong,
            unique password.
          </p>

          <h2 className="text-lg font-black text-foreground">Your choices and rights</h2>
          <p>
            You can view and edit your information in the app, and delete your account yourself. To request a copy of
            your data, or for any other privacy request, email{" "}
            <a className={linkClass} href={`mailto:${APP_SUPPORT_EMAIL}`}>
              {APP_SUPPORT_EMAIL}
            </a>
            . Depending on where you live, you may have more rights under local law, and we will honor them.
          </p>

          <h2 className="text-lg font-black text-foreground">Children</h2>
          <p>{APP_NAME} is a business tool and is not intended for anyone under 18.</p>

          <h2 className="text-lg font-black text-foreground">Changes</h2>
          <p>
            If we make material changes to this policy, we will update the date above and, where appropriate, notify you
            by email or in the app.
          </p>

          <p>
            Related: <Link to="/terms" className={linkClass}>Terms of use</Link>.
          </p>
        </div>
      </article>
    </PublicShell>
  )
}
