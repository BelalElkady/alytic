import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { post } from "@/lib/api";
import { siteUrl, siteName } from "@/lib/seo";

type ResetSearch = { token: string | undefined };

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  head: ({ match }) => ({
    meta: [
      { title: `إعادة تعيين كلمة السر — ${siteName(match)}` },
      { name: "description", content: `اكتب كلمة سر جديدة لحسابك في ${siteName(match)}.` },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: `إعادة تعيين كلمة السر — ${siteName(match)}` },
      { property: "og:url", content: `${siteUrl(match)}/reset-password` },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("كلمة السر غير متطابقة");
      return;
    }
    setBusy(true);
    try {
      await post("/api/auth/reset-password", { token, password });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر إعادة تعيين كلمة السر");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface px-4 py-12 text-center">
      <Logo tagline={false} />

      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        {!token ? (
          <div className="flex flex-col items-center gap-3">
            <XCircle className="size-8 text-down" />
            <p className="text-[15px] font-semibold">رابط إعادة التعيين غير صالح</p>
            <Link
              to="/forgot-password"
              className="mt-2 text-[13px] text-primary underline-offset-4 hover:underline"
            >
              اطلب رابط جديد
            </Link>
          </div>
        ) : done ? (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle2 className="size-8 text-up" />
            <p className="text-[15px] font-semibold">تم تغيير كلمة السر بنجاح</p>
            <Button
              className="mt-2 w-full"
              onClick={() => void navigate({ to: "/login", search: { mode: "login" } })}
            >
              تسجيل الدخول
            </Button>
          </div>
        ) : (
          <div className="text-start">
            <h1 className="text-xl font-semibold tracking-tight">إعادة تعيين كلمة السر</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              اكتب كلمة سر جديدة لحسابك.
            </p>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-password">كلمة السر الجديدة</Label>
                <Input
                  id="reset-password"
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-password-confirm">تأكيد كلمة السر</Label>
                <Input
                  id="reset-password-confirm"
                  type="password"
                  dir="ltr"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-md bg-down-soft px-3 py-2 text-[13px] text-down">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                تغيير كلمة السر
              </Button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
