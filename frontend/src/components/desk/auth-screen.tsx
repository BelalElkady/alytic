import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { GoogleSignInButton } from "@/components/desk/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useDesk } from "@/lib/store";

const PERKS = [
  "تجربة مجانية ٧ أيام بكل المزايا",
  "أسعار لحظية لأسهم البورصة المصرية",
  "وقف خسارة وأهداف وتوصية لكل سهم",
];

export function AuthScreen({ initialMode = "login" }: { initialMode?: "login" | "register" }) {
  const { signIn, signInWithGoogle } = useDesk();
  const navigate = useNavigate();
  const [register, setRegister] = useState(initialMode === "register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(
        register ? "register" : "login",
        register ? { name, email, phone, password } : { email, password },
      );
      await navigate({ to: "/portfolio" });
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر إكمال العملية");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setGoogleBusy(true);
    setError(null);
    try {
      await signInWithGoogle(credential);
      await navigate({ to: "/portfolio" });
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر تسجيل الدخول بجوجل");
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-surface lg:grid-cols-2">
      <section className="hidden flex-col justify-between border-e bg-card p-10 lg:flex">
        <Link to="/" aria-label="EGXpert">
          <Logo />
        </Link>
        <div>
          <h2 className="text-2xl font-bold leading-snug tracking-tight">
            مكتب محفظتك في البورصة المصرية
          </h2>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            سجّل دخولك وشوف كل سهم بالتفصيل: القيمة، الربح، وقف الخسارة، الهدف، والتوصية المناسبة
            لسلوكك الاستثماري.
          </p>
          <ul className="mt-6 space-y-2.5">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-2 text-[13.5px]">
                <Check className="mt-0.5 size-4 shrink-0 text-up" />
                {perk}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          EGXpert أداة تحليل ومساعدة في القرار — وليست توصية مالية مرخّصة.
        </p>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center lg:hidden">
            <Link to="/" aria-label="EGXpert">
              <Logo tagline={false} />
            </Link>
          </div>

          <div className="mb-5 text-start">
            <h1 className="text-xl font-semibold tracking-tight">
              {register ? "إنشاء حساب جديد" : "تسجيل الدخول"}
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {register
                ? "ابدأ تجربة مجانية ٧ أيام — بدون بطاقة."
                : "أهلًا بيك تاني. ادخل بياناتك للمتابعة."}
            </p>
          </div>

          <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
            <div className="relative">
              {googleBusy && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-card/70">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              )}
              <GoogleSignInButton
                onCredential={(credential) => void handleGoogleCredential(credential)}
                onError={(message) => setError(message)}
              />
            </div>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-[12px] text-muted-foreground">أو</span>
              <Separator className="flex-1" />
            </div>

            <form onSubmit={submit} className="space-y-4">
              {register && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name">الاسم</Label>
                  <Input
                    id="auth-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">البريد الإلكتروني</Label>
                <Input
                  id="auth-email"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              {register && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-phone">رقم الموبايل</Label>
                  <Input
                    id="auth-phone"
                    type="tel"
                    dir="ltr"
                    placeholder="01xxxxxxxxx"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    required
                    autoComplete="tel"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="auth-password">كلمة السر</Label>
                <Input
                  id="auth-password"
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete={register ? "new-password" : "current-password"}
                />
              </div>

              {error && (
                <p role="alert" className="rounded-md bg-down-soft px-3 py-2 text-[13px] text-down">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {register ? "إنشاء الحساب" : "دخول"}
              </Button>

              <p className="text-center text-[13px] text-muted-foreground">
                {register ? "عندك حساب؟" : "لسه جديد؟"}{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => {
                    setRegister((previous) => !previous);
                    setError(null);
                  }}
                >
                  {register ? "تسجيل الدخول" : "إنشاء حساب"}
                </button>
              </p>
            </form>
          </div>

          <p className="mt-4 text-center text-[12.5px] text-muted-foreground">
            <Link to="/pricing" className="underline-offset-4 hover:underline">
              شوف خطط الأسعار
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
