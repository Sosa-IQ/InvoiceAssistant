import { Link } from "react-router-dom"
import { PublicShell } from "@/components/PublicShell"
import { APP_NAME, APP_SUPPORT_EMAIL } from "@/lib/brand"

const linkClass = "font-bold text-foreground underline-offset-4 hover:underline"

export default function TermsPage() {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-black uppercase tracking-[0.14em] text-primary">Legal</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Terms of use</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated September 26, 2026</p>
        <div className="mt-8 space-y-5 text-sm leading-7 text-muted-foreground">
          <p>
            Welcome to {APP_NAME}. By creating an account or using the service, you agree to these terms and to our{" "}
            <Link to="/privacy" className={linkClass}>Privacy policy</Link>. If you do not agree, please do not use the
            service.
          </p>

          <h2 className="text-lg font-black text-foreground">The service</h2>
          <p>
            {APP_NAME} helps you create, save, and send invoices. The Free plan covers invoices, clients, catalog items,
            PDF export, importing past invoice PDFs, and a small monthly allowance of invoice emails. Pro adds unlimited
            invoice email, AI drafting and edits, voice input, and smart suggestions, with monthly usage allowances shown
            in the app. We may improve, change, or
            retire features over time.
          </p>

          <h2 className="text-lg font-black text-foreground">Eligibility and your account</h2>
          <p>
            You must be at least 18 and able to enter a binding agreement, and you use {APP_NAME} for your business or
            professional work. You are responsible for keeping your login credentials safe and for activity under your
            account. Keep your business and contact information accurate.
          </p>

          <h2 className="text-lg font-black text-foreground">Your content</h2>
          <p>
            You own the invoices, client details, and other content you enter. You give us permission to process that
            content only to operate the service, for example to save PDFs, send the emails you request, or generate AI
            drafts you request. You are responsible for having the right to use your clients&apos; information and for
            the accuracy of the invoices you send.
          </p>

          <h2 className="text-lg font-black text-foreground">Acceptable use</h2>
          <p>
            Do not use {APP_NAME} for unlawful activity, fraudulent invoices, spam, harassment, attempts to break
            security, automated abuse of AI or voice features, or interfering with other customers. We may limit,
            suspend, or close accounts that do so.
          </p>

          <h2 className="text-lg font-black text-foreground">Subscriptions and billing</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Pro is billed in advance, monthly or yearly, through Stripe, and renews automatically until you cancel.
              Prices and included usage are shown on the <Link to="/pricing" className={linkClass}>pricing page</Link>{" "}
              and at checkout. Promotional prices apply only for the period stated.
            </li>
            <li>
              You can cancel anytime from Billing. You keep Pro until the end of the period you already paid for, and
              then your account moves to Free. Your data is kept.
            </li>
            <li>
              Payments are non-refundable, including partial periods, except where the law requires otherwise. If you
              believe you were charged in error, contact us.
            </li>
            <li>
              Top-up packs are one-time purchases for extra AI or voice usage. Unused pack balance carries over while
              you have Pro. It is paused if Pro ends and resumes if you subscribe again. Packs have no cash value.
            </li>
            <li>
              If we change Pro pricing, we will give you notice before the change applies to your next renewal.
            </li>
          </ul>

          <h2 className="text-lg font-black text-foreground">AI and voice features</h2>
          <p>
            AI and voice results can be wrong or incomplete. Review every invoice before you send it. Usage is metered
            and limited by your plan.
          </p>

          <h2 className="text-lg font-black text-foreground">Ending your account</h2>
          <p>
            You can delete your account anytime from Settings. Deletion is permanent, removes your workspace data right
            away, and cancels any active subscription immediately without a refund for the current period. Export any
            invoices you need first. We may suspend or close accounts that violate these terms, and we will give notice
            when reasonably possible.
          </p>

          <h2 className="text-lg font-black text-foreground">Disclaimer and limitation of liability</h2>
          <p>
            The service is provided “as is” and “as available.” We do not guarantee uninterrupted availability or
            error-free AI output. To the fullest extent allowed by law, {APP_NAME} is not liable for indirect, incidental,
            or consequential damages, lost profits, or data loss. Our total liability for any claim is limited to the
            amount you paid us in the 12 months before the claim.
          </p>

          <h2 className="text-lg font-black text-foreground">Changes to these terms</h2>
          <p>
            We may update these terms. For material changes, we will update the date above and notify you by email or in
            the app. If you keep using {APP_NAME} after changes take effect, you accept the updated terms.
          </p>

          <h2 className="text-lg font-black text-foreground">Contact</h2>
          <p>
            Questions about these terms:{" "}
            <a className={linkClass} href={`mailto:${APP_SUPPORT_EMAIL}`}>
              {APP_SUPPORT_EMAIL}
            </a>
            .
          </p>
        </div>
      </article>
    </PublicShell>
  )
}
