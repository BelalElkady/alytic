import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/api";
import { SITE_URL } from "@/lib/seo";
import { useDesk } from "@/lib/store";

type VerifySearch = { token: string | undefined };

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>): VerifySearch => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "تفعيل البريد الإلكتروني — EGXpert" },
      { name: "description", content: "جارٍ تفعيل بريدك الإلكتروني لحسابك في EGXpert." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "تفعيل البريد الإلكتروني — EGXpert" },
      { property: "og:url", content: `${SITE_URL}/verify-email` },
    ],
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();
  const { user, markEmailVerified } = useDesk();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");
  const [message, setMessage] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setStatus("error");
      setMessage("رابط التفعيل غير صالح");
      return;
    }
    (async () => {
      try {
        await post("/api/auth/verify", { token });
        markEmailVerified();
        setStatus("ok");
      } catch (caught) {
        setStatus("error");
        setMessage(caught instanceof Error ? caught.message : "تعذر تفعيل البريد الإلكتروني");
      }
    })();
  }, [token, markEmailVerified]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface px-4 py-12 text-center">
      <Logo tagline={false} />

      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        {status === "checking" && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-[14px] text-muted-foreground">جارٍ تفعيل بريدك الإلكتروني…</p>
          </div>
        )}

        {status === "ok" && (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle2 className="size-8 text-up" />
            <p className="text-[15px] font-semibold">تم تفعيل بريدك الإلكتروني بنجاح</p>
            <Button
              className="mt-2 w-full"
              onClick={() =>
                void (user
                  ? navigate({ to: "/portfolio" })
                  : navigate({ to: "/login", search: { mode: "login" } }))
              }
            >
              {user ? "الذهاب للمحفظة" : "تسجيل الدخول"}
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3">
            <XCircle className="size-8 text-down" />
            <p className="text-[15px] font-semibold">تعذر تفعيل البريد الإلكتروني</p>
            {message && <p className="text-[13px] text-muted-foreground">{message}</p>}
            <Link
              to="/login"
              search={{ mode: "login" }}
              className="mt-2 text-[13px] text-primary underline-offset-4 hover:underline"
            >
              العودة لتسجيل الدخول
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
