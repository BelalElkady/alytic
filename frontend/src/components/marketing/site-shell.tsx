import { Link } from "@tanstack/react-router";
import { Menu, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BlogTicker } from "@/components/marketing/blog-ticker";
import { SiteFooter } from "@/components/marketing/site-footer";
import { ChatWidget } from "@/components/support/chat-widget";
import { useDesk } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";

const LINKS = [
  { to: "/", label: "الرئيسية" },
  { to: "/blog", label: "تابع اخبار البورصة" },
  { to: "/how-to-use", label: "طريقة الاستخدام" },
  { to: "/pricing", label: "الأسعار" },
  { to: "/about", label: "من نحن" },
  { to: "/contact", label: "تواصل معنا" },
] as const;

export function SiteShell({ children }: { children: ReactNode }) {
  const { name: brandName } = useTenant();
  // These marketing/blog pages are reachable while already logged in (e.g. via
  // the nav links above), so the header must reflect that instead of always
  // pointing at /login — otherwise a signed-in user sees "دخول" here and
  // assumes their session was lost.
  const { user } = useDesk();
  const { dark, toggle } = useTheme();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-card/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label={brandName}>
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
            {/* The inline nav above is md+ only; below that the same links
                live in this sheet so mobile visitors can still reach them. */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="القائمة">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64">
                <SheetHeader>
                  <SheetTitle>القائمة</SheetTitle>
                </SheetHeader>
                <nav className="mt-4 flex flex-col gap-1" aria-label="روابط الموقع">
                  {LINKS.map((link) => (
                    <SheetClose asChild key={link.to}>
                      <Link
                        to={link.to}
                        activeOptions={{ exact: link.to === "/" }}
                        className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="تبديل الوضع الليلي">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            {user ? (
              <Button
                asChild
                size="lg"
                className="bg-up text-white hover:bg-up/90 dark:text-black"
              >
                <Link to="/portfolio">لوحة التحكم</Link>
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

      <SiteFooter />

      {/* Signed-in only (it renders nothing otherwise) — but it belongs here
          as well as in the desk, because the subscribe and pricing pages are
          exactly where someone decides to ask about a plan. */}
      <ChatWidget />
    </div>
  );
}
