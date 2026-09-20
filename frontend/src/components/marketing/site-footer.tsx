import { Link } from "@tanstack/react-router";
import { Facebook, Instagram } from "lucide-react";

import { Logo } from "@/components/brand/logo";

const LINKS = [
  { to: "/blog", label: "تابع اخبار البورصة" },
  { to: "/how-to-use", label: "طريقة الاستخدام" },
  { to: "/contact", label: "تواصل معنا" },
  { to: "/privacy", label: "سياسة الخصوصية" },
] as const;

const SOCIALS = [
  { href: "https://www.instagram.com/egxpertapp/", label: "إنستجرام", Icon: Instagram },
  { href: "https://www.facebook.com/egxpertapp/", label: "فيسبوك", Icon: Facebook },
] as const;

/** The one footer for the whole site — marketing pages and the signed-in desk both render it. */
export function SiteFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          <div className="flex items-center gap-1.5">
            <span className="me-1 text-[13px] font-semibold text-foreground">تابعنا</span>
            {SOCIALS.map(({ href, label, Icon }) => (
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
        </div>
        <p className="max-w-3xl text-[14px] font-medium leading-relaxed text-muted-foreground">
          EGXpert أداة تحليل ومساعدة في القرار — وليست توصية مالية مرخّصة. القرار الأخير مسؤوليتك.
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
