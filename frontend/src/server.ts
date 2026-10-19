import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { backendUrl } from "./lib/backend";
import type { Tenant } from "./lib/tenant";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// www.egxpert.com served the same pages as egxpert.com, which search engines
// count as duplicate content. nginx forwards the original Host header, so the
// redirect lives here and ships with every deploy instead of in the VPS's
// hand-maintained nginx config.
// Every white-label site gets the same treatment: a www host is sent to that
// site's canonical origin as the backend knows it (tenant.siteUrl), never to
// whatever the Host header happens to say, which a client controls (that
// would make this an open redirect for any request nginx forwards with a
// foreign Host). A www host the backend doesn't know is left alone.
async function wwwRedirect(request: Request): Promise<Response | null> {
  const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!host.startsWith("www.")) return null;
  try {
    const res = await fetch(`${backendUrl()}/api/tenant`, {
      headers: { "x-forwarded-host": host.slice(4) },
    });
    if (!res.ok) return null;
    const siteUrl = ((await res.json()) as Tenant).siteUrl.replace(/\/+$/, "");
    if (new URL(siteUrl).host === host) return null;
    const url = new URL(request.url);
    return Response.redirect(`${siteUrl}${url.pathname}${url.search}`, 301);
  } catch {
    return null;
  }
}

// What the browser is told about every page.
//
// The enforced policy only carries the directives that can never break the
// site: no plugins, no <base> hijack, forms only post home, and nobody else
// may frame us (clickjacking). The full source allow-list rides along
// report-only — violations show up in the browser console without blocking
// anything — so it can be tuned against the real Google sign-in, Tag Manager
// and AdSense traffic and then promoted to the enforced header.
const ENFORCED_CSP = ["frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join("; ");
const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://www.googletagmanager.com https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://www.facebook.com https://connect.facebook.net https://accounts.google.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://*.googlesyndication.com https://*.doubleclick.net",
  "frame-src https://accounts.google.com https://*.googlesyndication.com https://*.doubleclick.net https://www.youtube-nocookie.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

function withSecurityHeaders(request: Request, response: Response): Response {
  // A 1xx/webSocket response can't be rebuilt; nothing to add to it anyway.
  if (response.status < 200 || response.status > 599) return response;

  const headers = new Headers(response.headers);
  const setDefault = (name: string, value: string) => {
    if (!headers.has(name)) headers.set(name, value);
  };
  const { pathname, protocol } = new URL(request.url);
  const isApi = pathname.startsWith("/api/");

  headers.set("X-Content-Type-Options", "nosniff");
  // Behind nginx the request reaches this process as http; the original scheme
  // is in X-Forwarded-Proto (see deploy/nginx/egxpert.conf).
  const secure = protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  if (secure) setDefault("Strict-Transport-Security", "max-age=31536000");

  // Proxied API responses already carry the backend's own (stricter) headers,
  // which setDefault leaves alone; pages get the page policy below.
  setDefault("Referrer-Policy", "strict-origin-when-cross-origin");
  setDefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  setDefault("X-Frame-Options", "SAMEORIGIN");
  setDefault("Content-Security-Policy", ENFORCED_CSP);
  if (!isApi) setDefault("Content-Security-Policy-Report-Only", REPORT_ONLY_CSP);
  // Blog pages change whenever a post is published or hidden; without this a
  // browser or proxy could replay an old /blog?page=N listing hidden posts.
  if (pathname === "/blog" || pathname.startsWith("/blog/")) setDefault("Cache-Control", "no-cache");

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handle(request: Request, env: unknown, ctx: unknown): Promise<Response> {
  const redirect = await wwwRedirect(request);
  if (redirect) return redirect;
  try {
    const handler = await getServerEntry();
    const response = await handler.fetch(request, env, ctx);
    return await normalizeCatastrophicSsrResponse(response);
  } catch (error) {
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return withSecurityHeaders(request, await handle(request, env, ctx));
  },
};
