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

const TOPICS = [
  "مشاكل الدخول والاشتراك والدفع.",
  "أسئلة عن استخدام الأداة.",
  "تصحيح خطأ في مقال: اكتب رابط المقال، والمعلومة اللي شايف إنها غلط، ومصدر التصحيح.",
  "اقتراحات.",
] as const;

// Each site's own accounts (brand.social), same as the footer.
const SOCIALS = [
  { key: "instagram", label: "إنستجرام" },
  { key: "facebook", label: "فيسبوك" },
] as const;

function ContactPage() {
  const { name: brandName, contactEmail, brand } = useTenant();
  const socials = SOCIALS.flatMap(({ key, label }) => {
    const href = brand.social?.[key];
    return href ? [{ href, label }] : [];
  });
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
        <h1 className="text-2xl font-bold tracking-tight">تواصل معنا</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
          عندك سؤال عن الأداة، أو ملاحظة، أو مشكلة في الاستخدام، أو لاحظت خطأ في مقال؟ ابعتلنا ونرد
          عليك في أقرب وقت.
        </p>

        <h2 className="mt-8 text-[16px] font-bold tracking-tight">وسائل التواصل</h2>
        <ul className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          {contactEmail && (
            <li>
              <strong className="text-foreground">الإيميل:</strong>{" "}
              <a href={`mailto:${contactEmail}`} dir="ltr" className="font-medium text-foreground underline underline-offset-4">
                {contactEmail}
              </a>
            </li>
          )}
          <li>
            <strong className="text-foreground">النموذج:</strong> املأ الاسم والإيميل والرسالة تحت.
          </li>
          {socials.length > 0 && (
            <li>
              <strong className="text-foreground">السوشيال ميديا:</strong>{" "}
              {socials.map(({ href, label }, index) => (
                <span key={href}>
                  {index > 0 && " | "}
                  <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                    {label}
                  </a>
                </span>
              ))}
            </li>
          )}
          <li>
            <strong className="text-foreground">المقر:</strong> القاهرة، مصر.
          </li>
        </ul>

        <h2 className="mt-8 text-[16px] font-bold tracking-tight">بنتواصل في إيه</h2>
        <ul className="mt-2 list-disc space-y-1.5 ps-5 text-[13.5px] leading-relaxed text-muted-foreground">
          {TOPICS.map((topic) => (
            <li key={topic}>{topic}</li>
          ))}
        </ul>

        <h2 className="mt-8 text-[16px] font-bold tracking-tight">قبل ما تبعت</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
          ما بنقدرش نرد على أسئلة من نوع "اشتري أو بيع سهم كذا"، لأن {brandName} أداة تحليل وليست
          جهة استشارات مالية مرخّصة.
        </p>

        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
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
              <h2 className="text-lg font-bold tracking-tight">ابعتلنا رسالة</h2>

              <form onSubmit={submit} className="mt-5 space-y-4">
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
