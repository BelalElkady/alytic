/**
 * Visitor consent for analytics and advertising pixels (Google Analytics,
 * Meta Pixel). Nothing here loads until the visitor says yes; the choice is
 * kept in this browser only. Storage can be blocked (private windows), in
 * which case the banner simply asks again on the next visit.
 *
 * AdSense is not gated here: it is loaded from the page head (Google checks
 * the site by that tag) and is covered by the privacy policy.
 */
export const META_PIXEL_ID = "1612671676275288";

const STORAGE_KEY = "egx-tracking-consent";

export type Consent = "granted" | "denied";

export function readConsent(): Consent | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "granted" || saved === "denied" ? saved : null;
  } catch {
    return null;
  }
}

export function saveConsent(choice: Consent): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
}

/** GA ids are written into an inline script, so only accept the real format. */
export function validGaId(id: string | undefined): string | undefined {
  return /^G-[A-Z0-9]{4,20}$/.test(id ?? "") ? id : undefined;
}

let loaded = false;

function addScript(attrs: { src?: string; text?: string }): void {
  const el = document.createElement("script");
  if (attrs.src) {
    el.src = attrs.src;
    el.async = true;
  }
  if (attrs.text) el.text = attrs.text;
  document.head.appendChild(el);
}

/**
 * Injects the tracking scripts once. `pixel` is only true for our own site: a
 * white-label client's visitors must never land in our Meta reports, and each
 * site reports to its own Analytics account or to none.
 */
export function loadTrackers({ gaId, pixel }: { gaId?: string | undefined; pixel: boolean }): void {
  if (loaded || typeof document === "undefined") return;
  loaded = true;

  const ga = validGaId(gaId);
  if (ga) {
    addScript({ src: `https://www.googletagmanager.com/gtag/js?id=${ga}` });
    addScript({
      text: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${ga}');`,
    });
  }

  if (pixel) {
    addScript({
      text: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`,
    });
  }
}

/** Test hook: lets a test load the trackers again in a fresh document. */
export function resetTrackersForTests(): void {
  loaded = false;
}
