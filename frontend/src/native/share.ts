import { SITE_URL } from "./config";
import { isNative } from "./platform";
import { track } from "./analytics";

/** The normal website URL for a stock — the same link opens the app when it is installed (see docs/deep-links.md). */
export const stockShareUrl = (code: string) => `${SITE_URL}/stocks/${encodeURIComponent(code.toUpperCase())}`;

/**
 * Shares a stock through the system share sheet (WhatsApp, Telegram, Messages,
 * mail...). Falls back to the Web Share API in a browser, then to the
 * clipboard. Returns which path was used so the caller can confirm to the user.
 */
export async function shareStock(code: string, name?: string): Promise<"shared" | "copied" | "cancelled"> {
  const url = stockShareUrl(code);
  const title = `${code.toUpperCase()}${name ? ` — ${name}` : ""} على EGXpert`;
  const text = `تحليل ${code.toUpperCase()} على EGXpert`;
  try {
    if (isNative()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, text, url, dialogTitle: "شارك التحليل" });
    } else if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title, text, url });
    } else {
      await navigator.clipboard.writeText(url);
      return "copied";
    }
    track("share", { content_type: "stock", item_id: code.toUpperCase() });
    return "shared";
  } catch (err) {
    // Dismissing the share sheet is not an error.
    if (err instanceof Error && /cancel|abort/i.test(`${err.name} ${err.message}`)) return "cancelled";
    throw err;
  }
}
