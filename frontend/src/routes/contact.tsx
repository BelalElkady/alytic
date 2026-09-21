import { createFileRoute } from "@tanstack/react-router";
import { Loader2, MailCheck } from "lucide-react";
import { useState } from "react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { post } from "@/lib/api";
import { canonical, siteUrl, siteName } from "@/lib/seo";
import { useTenant } from "@/lib/tenant";

export const Route = createFileRoute("/contact")({
  head: ({ match }) => ({
    meta: [
      { title: `تواصل معنا — ${siteName(match)}` },
      {
        name: "description",
        content: `عندك سؤال أو ملاحظة على ${siteName(match)}؟ ابعتلنا رسالة وهنرد عليك في أقرب وقت.`,
      },
      { property: "og:title", content: `تواصل معنا — ${siteName(match)}` },
      {
        property: "og:description",
        content: `عندك سؤال أو ملاحظة على ${siteName(match)}؟ ابعتلنا رسالة وهنرد عليك في أقرب وقت.`,
      },
      { property: "og:url", content: `${siteUrl(match)}/contact` },
    ],
    links: [canonical(match, "/contact")],
  }),
  component: ContactPage,
});

function ContactPage() {
  const { name: brandName } = useTenant();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/contact", { name, email, message });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر إرسال الرسالة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SiteShell>
      <section className="mx-auto w-full max-w-lg px-4 py-14 sm:py-16">
        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <MailCheck className="size-8 text-up" />
              <p className="text-[15px] font-semibold">وصلتنا رسالتك</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                شكرًا لتواصلك معانا — هنرد عليك على بريدك الإلكتروني في أقرب وقت.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">تواصل معنا</h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                عندك سؤال، ملاحظة، أو مشكلة في استخدام {brandName}؟ اكتبلنا وهنرد عليك بأسرع ما
                يمكن.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="contact-name">الاسم</Label>
                  <Input
                    id="contact-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={100}
                    autoComplete="name"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contact-email">البريد الإلكتروني</Label>
                  <Input
                    id="contact-email"
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contact-message">رسالتك</Label>
                  <Textarea
                    id="contact-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    required
                    maxLength={4000}
                    rows={6}
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-md bg-down-soft px-3 py-2 text-[13px] text-down"
                  >
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  إرسال الرسالة
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </SiteShell>
  );
}
