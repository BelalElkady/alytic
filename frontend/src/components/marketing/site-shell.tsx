import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { BlogTicker } from "@/components/marketing/blog-ticker";
import { useDesk } from "@/lib/store";

const LINKS = [
  { to: "/", label: "الرئيسية" },
  { to: "/blog", label: "تابع اخبار البورصة" },
  { to: "/pricing", label: "الأسعار" },
  { to: "/contact", label: "تواصل معنا" },
] as const;

export function SiteShell({ children }: { children: ReactNode }) {
  // These marketing/blog pages are reachable while already logged in (e.g. via
  // the nav links above), so the header must reflect that instead of always
  // pointing at /login — otherwise a signed-in user sees "دخول" here and
  // assumes their session was lost.
  const { user } = useDesk();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-card/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label="EGXpert">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="روابط الموقع">
            {LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                activeOptions={{ exact: link.to === "/" }}
                className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Button asChild size="sm">
                <Link to="/portfolio">صفحتك</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login" search={{ mode: "login" }}>
                    دخول
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/pricing">ابدأ مجانًا</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <BlogTicker />

      <main className="flex-1">{children}</main>

      <footer className="border-t bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            EGXpert أداة تحليل ومساعدة في القرار — وليست توصية مالية مرخّصة. القرار الأخير مسؤوليتك.
          </p>
          <div className="flex items-center gap-4">
            <Link
              to="/how-to-use"
              className="text-[12.5px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              طريقة الاستخدام
            </Link>
            <Link
              to="/contact"
              className="text-[12.5px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              تواصل معنا
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
