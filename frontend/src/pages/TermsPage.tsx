import { Link } from "react-router-dom"
import { PublicShell } from "@/components/PublicShell"
import { APP_NAME, APP_SUPPORT_EMAIL } from "@/lib/brand"

export default function TermsPage() {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-black uppercase tracking-[0.14em] text-primary">Legal</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Terms of use</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated July 30, 2026</p>
        <div className="mt-8 space-y-5 text-sm leading-7 text-muted-foreground">
          <p>
            Welcome to {APP_NAME}. By creating an account or using the service, you agree to these terms. If you do not
            agree, please do not use the service.
          </p>
          <h2 className="text-lg font-black text-foreground">The service</h2>
          <p>
            {APP_NAME} helps you create, save, and manage invoices. Free features cover manual invoicing and PDF export.
            Paid Pro features may include AI drafting, voice transcription, email delivery, and related usage limits.
          </p>
          <h2 className="text-lg font-black text-foreground">Your account</h2>
          <p>
            You are responsible for your login credentials and for activity under your account. Provide accurate business
            and contact information when you use billing or email features.
          </p>
          <h2 className="text-lg font-black text-foreground">Your content</h2>
          <p>
            You own the invoices, client details, and other content you enter. You grant us permission to process that
            content only to operate the service (for example, saving PDFs, sending email you request, or generating AI
            drafts you request).
          </p>
          <h2 className="text-lg font-black text-foreground">Acceptable use</h2>
          <p>
            Do not use {APP_NAME} for unlawful activity, spam, abuse of AI/voice limits, attempts to break security, or
            interference with other customers. We may suspend accounts that harm the service or other users.
          </p>
          <h2 className="text-lg font-black text-foreground">Subscriptions and billing</h2>
          <p>
            Paid plans are billed through Stripe. Prices, included usage, and top-up packs are shown in the app. Fees are
            generally non-refundable except where required by law or stated otherwise at purchase. Cancel anytime; access
            continues through the paid period already purchased.
          </p>
          <h2 className="text-lg font-black text-foreground">AI and voice features</h2>
          <p>
            AI and voice outputs can be wrong or incomplete. You are responsible for reviewing invoices before sending
            them to clients. Usage is metered and may be limited.
          </p>
          <h2 className="text-lg font-black text-foreground">Disclaimer</h2>
          <p>
            The service is provided “as is.” We do not guarantee uninterrupted availability or that AI output is
            error-free. To the fullest extent allowed by law, {APP_NAME} is not liable for indirect or consequential
            damages, lost profits, or data loss.
          </p>
          <h2 className="text-lg font-black text-foreground">Contact</h2>
          <p>
            Questions about these terms:{" "}
            <a className="font-bold text-foreground underline-offset-4 hover:underline" href={`mailto:${APP_SUPPORT_EMAIL}`}>
              {APP_SUPPORT_EMAIL}
            </a>
            . See also our <Link to="/privacy" className="font-bold text-foreground underline-offset-4 hover:underline">Privacy policy</Link>.
          </p>
        </div>
      </article>
    </PublicShell>
  )
}
