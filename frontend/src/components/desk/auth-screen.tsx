import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Loader2, MailCheck } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { isNative } from "@/native/platform";
import { GoogleSignInButton } from "@/components/desk/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Separator } from "@/components/ui/separator";
import { useDesk } from "@/lib/store";
import { useTenant } from "@/lib/tenant";

const PERKS = [
  "تجربة مجانية ٥ أيام تداول بكل المزايا",
  "أسعار لحظية لأسهم البورصة المصرية",
  "وقف خسارة وأهداف وتوصية لكل سهم",
];

export function AuthScreen({ initialMode = "login" }: { initialMode?: "login" | "register" }) {
  const { name: brandName } = useTenant();
  const { signIn, signInWithGoogle } = useDesk();
  const navigate = useNavigate();
  const [register, setRegister] = useState(initialMode === "register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [registered, setRegistered] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (register) {
        await signIn("register", { name, email, phone, password });
        setRegistered(true);
      } else {
        await signIn("login", { email, password, remember });
        await navigate({ to: "/" });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر إكمال العملية");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setGoogleBusy(true);
    setError(null);
    try {
      await signInWithGoogle(credential);
      await navigate({ to: "/" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تسجيل الدخول بجوجل");
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-surface lg:grid-cols-2">
      <section className="hidden flex-col justify-between border-e bg-card p-10 lg:flex">
        <Link to="/" aria-label={brandName}>
          <Logo />
        </Link>
        <div>
          <h2 className="text-2xl font-bold leading-snug tracking-tight">
            كل قرار في محفظتك مبني على أرقام، مش تخمين
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
          {brandName} أداة تحليل ومساعدة في القرار — وليست توصية مالية مرخّصة.
        </p>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center lg:hidden">
            <Link to="/" aria-label={brandName}>
              <Logo tagline={false} />
            </Link>
          </div>

          {registered ? (
            <div className="space-y-4 rounded-xl border bg-card p-6 text-center shadow-sm">
              <div className="flex flex-col items-center gap-3">
                <MailCheck className="size-8 text-up" />
                <p className="text-[15px] font-semibold">تحقق من بريدك الإلكتروني</p>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  لو الإيميل ده مش مسجل قبل كده، بعتنالك رابط تفعيل عليه — افتحه عشان تفعّل حسابك،
                  وبعدين سجّل دخولك عادي.
                </p>
                <button
                  type="button"
                  className="mt-2 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => {
                    setRegistered(false);
                    setRegister(false);
                  }}
                >
                  العودة لتسجيل الدخول
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-5 text-start">
                <h1 className="text-xl font-semibold tracking-tight">
                  {register ? "إنشاء حساب جديد" : "تسجيل الدخول"}
                </h1>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {register
                    ? "ابدأ تجربة مجانية ٥ أيام تداول — بدون بطاقة."
                    : "أهلًا بيك تاني. ادخل بياناتك للمتابعة."}
                </p>
              </div>

              <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
                {/* Google's web sign-in cannot run from the app's own origin; email + password works natively. */}
                {!isNative() && (
                  <>
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
                  </>
                )}

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
                        placeholder="+20 10 1234 5678"
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        required
                        autoComplete="tel"
                      />
                      <p className="text-[12px] text-muted-foreground">
                        أي دولة — اكتب الرقم بكود الدولة (مثال: +966 5x xxx xxxx). الأرقام المصرية تتكتب 01xxxxxxxxx.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="auth-password">كلمة السر</Label>
                      {!register && (
                        <Link
                          to="/forgot-password"
                          className="text-[12.5px] text-primary underline-offset-4 hover:underline"
                        >
                          نسيت كلمة السر؟
                        </Link>
                      )}
                    </div>
                    <PasswordInput
                      id="auth-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      autoComplete={register ? "new-password" : "current-password"}
                    />
                  </div>

                  {!register && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="auth-remember"
                        checked={remember}
                        onCheckedChange={(checked) => setRemember(checked === true)}
                      />
                      <Label
                        htmlFor="auth-remember"
                        className="cursor-pointer text-[13px] font-normal"
                      >
                        فضّلني مسجّل دخول
                      </Label>
                    </div>
                  )}

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
            </>
          )}

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
