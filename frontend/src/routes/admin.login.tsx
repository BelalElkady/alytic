import { createFileRoute } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { post } from "@/lib/api";
import { SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [
      { title: "دخول المشرف — EGXpert" },
      { name: "description", content: "تسجيل دخول مخصص لمشرفي EGXpert." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "دخول المشرف — EGXpert" },
      { property: "og:url", content: `${SITE_URL}/admin/login` },
    ],
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await post("/api/auth/login", { email, password });
      if (!result.user?.isAdmin) {
        await post("/api/auth/logout");
        throw new Error("الحساب ده مش حساب مشرف");
      }
      // Full navigation, not the router — DeskProvider only reads the session
      // once on mount, and this page never mounted it.
      window.location.href = "/admin";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo tagline={false} />
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ShieldCheck className="size-4" />
            <span className="text-[13px] font-medium">دخول المشرف</span>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">البريد الإلكتروني</Label>
            <Input
              id="admin-email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">كلمة السر</Label>
            <Input
              id="admin-password"
              type="password"
              dir="ltr"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-down-soft px-3 py-2 text-[13px] text-down">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            دخول
          </Button>
        </form>
      </div>
    </main>
  );
}
