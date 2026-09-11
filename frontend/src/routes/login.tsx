import { createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "@/components/desk/auth-screen";

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
          "ادخل على حسابك في EGXpert لمتابعة محفظتك في البورصة المصرية، أو ابدأ تجربة مجانية ٧ أيام.",
      },
      { property: "og:title", content: "دخول أو إنشاء حساب — EGXpert" },
      {
        property: "og:description",
        content: "دخول سريع لـ EGXpert، أو إنشاء حساب جديد بتجربة مجانية ٧ أيام.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { mode } = Route.useSearch();
  return <AuthScreen initialMode={mode === "register" ? "register" : "login"} />;
}
