// Server-side calls from this frontend process to the Express backend (server
// functions, the sitemap, the /api/public proxy). The backend serves several
// white-label sites and picks one from the host, so every call carries the
// host the browser actually asked for in X-Forwarded-Host. Without it the
// backend sees this process's own loopback request and answers as the
// default site — a client's blog page would list the main site's posts.
//
// Only call these from server code: a server function handler or a server
// route. The server module is imported lazily so client bundles never
// include it.

export const backendUrl = () => process.env["ALYTIC_API_URL"] ?? "http://localhost:3000";

/** The Host the incoming request was made to (nginx passes it through), or null outside a request. */
export async function incomingHost(): Promise<string | null> {
  try {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    return getRequestHeader("host") ?? null;
  } catch {
    return null;
  }
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const host = await incomingHost();
  if (host) headers.set("x-forwarded-host", host);
  return fetch(`${backendUrl()}${path}`, { ...init, headers });
}
