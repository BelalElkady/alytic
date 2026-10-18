import { cn } from "@/lib/utils";

// http(s):// and www. links only — never javascript: or other schemes. Trailing
// punctuation that ends the sentence rather than the URL is left outside it.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}،؛؟]+$/;

/**
 * Message text with its URLs as links; everything else stays plain text.
 * `onPrimary` is for a bubble drawn on the primary colour, where the link keeps
 * the bubble's own text colour instead of the primary one.
 */
export function Linkified({ text, onPrimary = false }: { text: string; onPrimary?: boolean }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING_PUNCT_RE, "");
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={/^www\./i.test(url) ? `https://${url}` : url}
        target="_blank"
        rel="noopener noreferrer"
        dir="ltr"
        className={cn(
          "break-all font-medium underline underline-offset-2",
          !onPrimary && "text-primary",
        )}
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
