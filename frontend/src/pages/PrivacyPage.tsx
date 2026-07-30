import { Link } from "react-router-dom"
import { PublicShell } from "@/components/PublicShell"
import { APP_NAME, APP_SUPPORT_EMAIL } from "@/lib/brand"

export default function PrivacyPage() {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-black uppercase tracking-[0.14em] text-primary">Legal</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Privacy policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated July 30, 2026</p>
        <div className="mt-8 space-y-5 text-sm leading-7 text-muted-foreground">
          <p>
            {APP_NAME} is built for small businesses that expect their client and invoice data to stay private. This
            policy explains what we collect and why.
          </p>
          <h2 className="text-lg font-black text-foreground">Information we collect</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Account details such as email address and authentication identifiers</li>
            <li>Business profile, clients, catalog items, and invoice content you enter</li>
            <li>Usage and billing events needed to run subscriptions, AI/voice meters, and support</li>
            <li>Technical logs (for example request times and error diagnostics)</li>
          </ul>
          <h2 className="text-lg font-black text-foreground">How we use information</h2>
          <p>
            We use your information to provide the product, secure accounts, process payments via Stripe, send invoices
            you ask us to email, improve reliability, and comply with law. We do not sell your personal data or invoice
            contents.
          </p>
          <h2 className="text-lg font-black text-foreground">Processors</h2>
          <p>
            Trusted providers help us operate the service (for example authentication/database hosting, payment
            processing with Stripe, and AI/voice providers when you use those features). They process data only to
            perform those services.
          </p>
          <h2 className="text-lg font-black text-foreground">Retention</h2>
          <p>
            We keep account and invoice data while your account is active and for a reasonable period afterward for
            backups, disputes, or legal requirements. You may request deletion of your account by contacting support.
          </p>
          <h2 className="text-lg font-black text-foreground">Security</h2>
          <p>
            We use industry-standard safeguards such as encrypted transport and access controls. No method of
            transmission or storage is perfectly secure.
          </p>
          <h2 className="text-lg font-black text-foreground">Your choices</h2>
          <p>
            You can update profile information in Settings, manage billing in the app, and contact us to ask questions
            about your data. Email{" "}
            <a className="font-bold text-foreground underline-offset-4 hover:underline" href={`mailto:${APP_SUPPORT_EMAIL}`}>
              {APP_SUPPORT_EMAIL}
            </a>
            .
          </p>
          <p>
            Related: <Link to="/terms" className="font-bold text-foreground underline-offset-4 hover:underline">Terms of use</Link>.
          </p>
        </div>
      </article>
    </PublicShell>
  )
}
