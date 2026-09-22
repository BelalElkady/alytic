// PROTOTYPE — throwaway. Floating bar that cycles `?variant=` on the current page. Never ships: hidden in production builds.
import { useEffect, useState } from "react";

const readVariant = () =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("variant");

/** The current `?variant=` value, or null when the page isn't in prototype mode (and always null in production). */
export function usePrototypeVariant(): [string | null, (next: string) => void] {
  const [variant, setVariant] = useState<string | null>(null);
  useEffect(() => setVariant(readVariant()), []);
  const set = (next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(window.history.state, "", url);
    setVariant(next);
  };
  return [import.meta.env.PROD ? null : variant, set];
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (next: string) => void;
}) {
  const index = Math.max(0, variants.findIndex((v) => v.key === current));
  const step = (delta: number) => onChange(variants[(index + delta + variants.length) % variants.length].key);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;
  const v = variants[index];
  return (
    <div
      dir="ltr"
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-black px-4 py-2 font-mono text-sm text-white shadow-2xl ring-2 ring-yellow-400"
    >
      <button type="button" onClick={() => step(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        PROTOTYPE {v.key} ({v.name})
      </span>
      <button type="button" onClick={() => step(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
}
