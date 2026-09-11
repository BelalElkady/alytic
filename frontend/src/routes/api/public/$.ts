import { createFileRoute } from "@tanstack/react-router";

// Same-origin proxy to the Alytic Express server. The browser keeps talking to
// this origin (so the session cookie works unchanged); this route forwards
// everything under /api/* to the backend untouched.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "host",
  "content-length",
]);

async function forward(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = process.env["ALYTIC_API_URL"] ?? "http://localhost:3000";
  const upstreamPath = url.pathname.replace(/^\/api\/public/, "");
  const upstream = `${target}${upstreamPath}${url.search}`;

  const isLovablePreview = request.headers.get("x-lovable-preview") === "1";

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let res: Response;
  try {
    res = await fetch(upstream, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : null,
      redirect: "manual",
    });
  } catch (err) {
    // The Alytic backend is unreachable (not running, or not available from this
    // deployment). Answer with a clear JSON error instead of throwing a 500.
    return Response.json(
      {
        error: "لا يمكن الوصول إلى خدمة Alytic الآن. تأكد أن السيرفر يعمل ثم أعد المحاولة.",
      },
      { status: 502 },
    );
  }


  const out = new Headers();
  res.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    // The Lovable editor preview runs inside an iframe, which is a cross-site
    // context: a SameSite=Lax cookie would never be sent back there. Re-issue
    // the session cookie so that preview keeps it (backend behaviour
    // untouched). Everywhere else (real top-level browsing, local dev) the
    // backend's own SameSite=Lax cookie is left alone — forcing Secure there
    // unconditionally silently drops the cookie on any non-HTTPS origin.
    if (key.toLowerCase() === "set-cookie" && isLovablePreview) {
      let cookie = value.replace(/;\s*SameSite=[^;]*/gi, "");
      if (!/;\s*Secure/i.test(cookie)) cookie += "; Secure";
      cookie += "; SameSite=None; Partitioned";
      out.append(key, cookie);
      return;
    }
    out.append(key, value);
  });


  // Alytic currently reports an existing registration as a generic 500. It is
  // an expected account conflict, so normalize only that known response while
  // preserving the original Arabic error shown by the form.
  if (upstreamPath === "/api/auth/register" && res.status === 500) {
    const body = await res.text();
    try {
      const data = JSON.parse(body) as { error?: unknown };
      if (data.error === "البريد الإلكتروني مسجل بالفعل") {
        return new Response(body, { status: 409, headers: out });
      }
    } catch {
      // Preserve unexpected non-JSON upstream responses unchanged.
    }
    return new Response(body, { status: res.status, statusText: res.statusText, headers: out });
  }

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

export const Route = createFileRoute("/api/public/$")({
  server: {
    handlers: {
      GET: ({ request }) => forward(request),
      POST: ({ request }) => forward(request),
      PUT: ({ request }) => forward(request),
      PATCH: ({ request }) => forward(request),
      DELETE: ({ request }) => forward(request),
    },
  },
});
