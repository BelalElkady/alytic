import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AuthScreen } from "@/components/desk/auth-screen";
import { useDesk } from "@/lib/store";

type LoginSearch = { mode: "login" | "register" };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    mode: search["mode"] === "register" ? "register" : "login",
  }),
  head: () => ({
    meta: [
      { title: "دخول أو إنشاء حساب — EGXpert" },
      {
        name: "description",
        content:
          "ادخل على حسابك في EGXpert لمتابعة محفظتك في البورصة المصرية، أو ابدأ تجربة مجانية ٤ أيام.",
      },
      { property: "og:title", content: "دخول أو إنشاء حساب — EGXpert" },
      {
        property: "og:description",
        content: "دخول سريع لـ EGXpert، أو إنشاء حساب جديد بتجربة مجانية ٤ أيام.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { mode } = Route.useSearch();
  const { user, authChecked } = useDesk();
  const navigate = useNavigate();

  // Reachable while already signed in (e.g. a stale "دخول" link, or a direct
  // visit) — bounce straight to the desk instead of showing the form again.
  useEffect(() => {
    if (authChecked && user) void navigate({ to: "/portfolio", replace: true });
  }, [authChecked, user, navigate]);

  if (authChecked && user) return null;
  return <AuthScreen initialMode={mode === "register" ? "register" : "login"} />;
}
