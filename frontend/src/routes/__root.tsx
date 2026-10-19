import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { ConsentBanner } from "@/components/consent-banner";
import { PresenceBeacon } from "@/components/presence-beacon";
import { Toaster } from "@/components/ui/sonner";
import { ogImageUrl, siteUrl } from "@/lib/seo";
import { DEFAULT_TENANT, brandCss, tenantOf, type Tenant } from "@/lib/tenant";
import { getTenant } from "@/lib/tenant-server";
import { DeskProvider } from "@/lib/store";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">الصفحة مش موجودة</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          الصفحة اللي بتدوّر عليها مش موجودة أو اتنقلت لمكان تاني.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">الصفحة مفتحتش</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          حصلت مشكلة من عندنا. جرّب تحدّث الصفحة أو ارجع للرئيسية.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            جرّب تاني
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            الرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}

// The browser only ever shows one site, so once the tenant is known on the
// client it is kept for the rest of the visit. Never cached like this on the
// server, where one process renders every site.
let browserTenant: Tenant | null = null;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Which white-label site this is (see lib/tenant.ts). Put in the route
  // context rather than loader data because every child route inherits the
  // context, and a child's head() can read it from its own match.
  beforeLoad: async () => {
    if (browserTenant) return { tenant: browserTenant };
    const tenant = await getTenant();
    if (typeof window !== "undefined") browserTenant = tenant;
    return { tenant };
  },
  head: ({ match }) => {
    const tenant = tenantOf(match);
    const { brand } = tenant;
    const description = brand.description ?? DEFAULT_TENANT.brand.description ?? "";
    const title = brand.tagline ? `${tenant.name} — ${brand.tagline}` : tenant.name;
    const css = brandCss(brand);
    const adsClient = /^ca-pub-\d{10,20}$/.test(brand.analytics?.adsClient ?? "")
      ? brand.analytics?.adsClient
      : undefined;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title },
        { name: "description", content: description },
        { name: "robots", content: "index, follow" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: siteUrl(match) },
        { property: "og:image", content: ogImageUrl(match) },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: ogImageUrl(match) },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        ...(brand.faviconUrl
          ? [
              {
                rel: "icon",
                href: brand.faviconUrl,
                ...(brand.faviconUrl.endsWith(".svg") ? { type: "image/svg+xml" } : {}),
              },
            ]
          : []),
        ...(tenant.id === DEFAULT_TENANT.id
          ? [{ rel: "icon", href: "/favicon.ico", type: "image/x-icon" }]
          : []),
      ],
      styles: css ? [{ children: css }] : [],
      // AdSense stays in the head (Google verifies the site by this tag).
      // Analytics and the Meta Pixel load only after the visitor agrees; see
      // lib/consent.ts. Each site reports to its own AdSense account or none.
      scripts: adsClient
        ? [
            {
              src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`,
              async: true,
              crossOrigin: "anonymous" as const,
            },
          ]
        : [],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <DeskProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </DeskProvider>
      <PresenceBeacon />
      <ConsentBanner />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
