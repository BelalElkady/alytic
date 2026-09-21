import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AuthScreen } from "@/components/desk/auth-screen";
import { siteUrl, siteName } from "@/lib/seo";
import { useDesk } from "@/lib/store";

type LoginSearch = { mode: "login" | "register" };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    mode: search["mode"] === "register" ? "register" : "login",
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `دخول أو إنشاء حساب — ${siteName(matches)}` },
      {
        name: "description",
        content: `ادخل على حسابك في ${siteName(matches)} لمتابعة محفظتك في البورصة المصرية، أو ابدأ تجربة مجانية ٥ أيام تداول.`,
      },
      { property: "og:title", content: `دخول أو إنشاء حساب — ${siteName(matches)}` },
      {
        property: "og:description",
        content: `دخول سريع لـ ${siteName(matches)}، أو إنشاء حساب جديد بتجربة مجانية ٥ أيام تداول.`,
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${siteUrl(matches)}/login` },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { mode } = Route.useSearch();
  const { user, authChecked } = useDesk();
  const navigate = useNavigate();

  // Reachable while already signed in (e.g. a stale "دخول" link, or a direct
  // visit) — bounce straight home instead of showing the form again.
  useEffect(() => {
    if (authChecked && user) void navigate({ to: "/", replace: true });
  }, [authChecked, user, navigate]);

  if (authChecked && user) return null;
  return <AuthScreen initialMode={mode === "register" ? "register" : "login"} />;
}
