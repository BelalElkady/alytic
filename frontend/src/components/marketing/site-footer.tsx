import { Link } from "@tanstack/react-router";
import { Facebook, Instagram } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { useTenant } from "@/lib/tenant";

const LINKS = [
  { to: "/blog", label: "تابع اخبار البورصة" },
  { to: "/how-to-use", label: "طريقة الاستخدام" },
  { to: "/about", label: "من نحن" },
  { to: "/contact", label: "تواصل معنا" },
  { to: "/privacy", label: "سياسة الخصوصية" },
] as const;

// Each site's own accounts (brand.social); a network the site has no account
// on is left out, and the "تابعنا" row disappears when there are none.
const SOCIALS = [
  { key: "instagram", label: "إنستجرام", Icon: Instagram },
  { key: "facebook", label: "فيسبوك", Icon: Facebook },
] as const;

/** The one footer for the whole site — marketing pages and the signed-in desk both render it. */
export function SiteFooter() {
  const { name: brandName, brand } = useTenant();
  const socials = SOCIALS.flatMap(({ key, label, Icon }) => {
    const href = brand.social?.[key];
    return href ? [{ href, label, Icon }] : [];
  });
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          {socials.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="me-1 text-[13px] font-semibold text-foreground">تابعنا</span>
              {socials.map(({ href, label, Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="grid size-9 place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          )}
        </div>
        <p className="max-w-3xl text-[14px] font-medium leading-relaxed text-muted-foreground">
          {brandName} أداة تحليل ومساعدة في القرار — وليست توصية مالية مرخّصة. القرار الأخير
          مسؤوليتك.
        </p>
        <nav
          aria-label="روابط التذييل"
          className="grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-5 sm:flex sm:flex-wrap sm:gap-x-6"
        >
          {LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
