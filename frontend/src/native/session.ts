import { clearSessionToken, loadSessionToken, saveSessionToken } from "./secure-session";
import { isNative } from "./platform";

/**
 * Glue between the login endpoints and secure storage. The backend includes a
 * `token` in a login response only when the request comes from the native
 * app's origin, so on the web `result.token` is always undefined and this does
 * nothing.
 */
export async function persistLoginResult(result: { token?: unknown } | null | undefined) {
  if (!isNative()) return;
  if (typeof result?.token === "string" && result.token) await saveSessionToken(result.token);
}

export { clearSessionToken, loadSessionToken };

/** Token lifetime is 30 days on the server; refresh (sliding) once it is older than this. */
export const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
