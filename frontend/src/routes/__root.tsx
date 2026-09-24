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

import { PresenceBeacon } from "@/components/presence-beacon";
import { Toaster } from "@/components/ui/sonner";
import { ogLogoUrl, siteUrl } from "@/lib/seo";
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
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
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
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
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

const META_PIXEL_ID = "1612671676275288";

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
    // Re-checked here as well as on save: gaId is written into an inline script.
    const gaId = /^G-[A-Z0-9]{4,20}$/.test(brand.analytics?.gaId ?? "") ? brand.analytics?.gaId : undefined;
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
        { property: "og:image", content: ogLogoUrl(match) },
        { name: "twitter:card", content: "summary_large_image" },
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
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap",
        },
      ],
      styles: css ? [{ children: css }] : [],
      // Each site reports to its own AdSense / Analytics account, or to none:
      // a client's traffic must never land in someone else's reports. The
      // IDs are format-checked by the backend before they are saved.
      scripts: [
        ...(adsClient
          ? [
              {
                src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`,
                async: true,
                crossOrigin: "anonymous" as const,
              },
            ]
          : []),
        ...(gaId
          ? [
              { src: `https://www.googletagmanager.com/gtag/js?id=${gaId}`, async: true },
              {
                children: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}');`,
              },
            ]
          : []),
        // Meta Pixel: our own site only, same rule as above — a client's
        // visitors must not land in our Meta reports.
        ...(tenant.id === DEFAULT_TENANT.id
          ? [
              {
                children: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`,
              },
            ]
          : []),
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const { tenant } = Route.useRouteContext();
  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {tenant.id === DEFAULT_TENANT.id && (
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              alt=""
              src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
            />
          </noscript>
        )}
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
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
