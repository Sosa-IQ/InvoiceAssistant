import { useState } from "react"
import { PublicShell } from "@/components/PublicShell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { APP_NAME, APP_SUPPORT_EMAIL } from "@/lib/brand"

export default function ContactPage() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")

  function openMail() {
    const subject = encodeURIComponent(`${APP_NAME} support`)
    const body = encodeURIComponent(
      `Name: ${name.trim() || "(not provided)"}\nEmail: ${email.trim() || "(not provided)"}\n\n${message.trim()}`,
    )
    window.location.href = `mailto:${APP_SUPPORT_EMAIL}?subject=${subject}&body=${body}`
  }

  return (
    <PublicShell>
      <section className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-black uppercase tracking-[0.14em] text-primary">Support</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Contact {APP_NAME}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Questions about your account, billing, or the product? Email us directly or use the form below to open a
          message in your mail app.
        </p>
        <p className="mt-4 text-sm font-bold">
          <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${APP_SUPPORT_EMAIL}`}>
            {APP_SUPPORT_EMAIL}
          </a>
        </p>

        <form
          className="mt-8 space-y-4 rounded-[28px] border border-border bg-card p-5 shadow-sm sm:p-8"
          onSubmit={(e) => {
            e.preventDefault()
            openMail()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="contact-name">Name</Label>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} className="min-h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-11"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-message">Message</Label>
            <Textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-36"
              required
            />
          </div>
          <Button type="submit" className="min-h-12 w-full rounded-xl font-black sm:w-auto sm:px-8">
            Open email to support
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            This opens your email app with a draft addressed to {APP_SUPPORT_EMAIL}. Nothing is stored on our servers
            from this form yet.
          </p>
        </form>
      </section>
    </PublicShell>
  )
}
