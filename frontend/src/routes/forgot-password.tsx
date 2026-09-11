import { Link, createFileRoute } from "@tanstack/react-router";
import { Loader2, MailCheck } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { post } from "@/lib/api";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [{ title: "نسيت كلمة السر — EGXpert" }],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/forgot-password", { email });
      setSent(true);
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر إرسال رابط إعادة التعيين");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface px-4 py-12 text-center">
      <Link to="/" aria-label="EGXpert">
        <Logo tagline={false} />
      </Link>

      <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-start shadow-sm">
        {sent ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <MailCheck className="size-8 text-up" />
            <p className="text-[15px] font-semibold">تحقق من بريدك الإلكتروني</p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              لو البريد ده مسجل عندنا، هيوصلك رابط لإعادة تعيين كلمة السر خلال دقايق.
            </p>
            <Link to="/login" search={{ mode: "login" }} className="mt-2 text-[13px] text-primary underline-offset-4 hover:underline">
              العودة لتسجيل الدخول
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight">نسيت كلمة السر؟</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              اكتب بريدك الإلكتروني وهنبعتلك رابط لإعادة تعيين كلمة السر.
            </p>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">البريد الإلكتروني</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-md bg-down-soft px-3 py-2 text-[13px] text-down">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                إرسال رابط إعادة التعيين
              </Button>

              <p className="text-center text-[13px] text-muted-foreground">
                <Link to="/login" search={{ mode: "login" }} className="font-medium text-primary underline-offset-4 hover:underline">
                  العودة لتسجيل الدخول
                </Link>
              </p>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
