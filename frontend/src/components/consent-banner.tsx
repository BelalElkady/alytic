import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { loadTrackers, readConsent, saveConsent, type Consent } from "@/lib/consent";
import { DEFAULT_TENANT, useTenant } from "@/lib/tenant";

/**
 * Asks once before analytics and ad pixels load. A returning visitor who
 * already agreed gets the scripts straight away and no banner; one who
 * declined gets neither.
 */
export function ConsentBanner() {
  const tenant = useTenant();
  const [choice, setChoice] = useState<Consent | null | "unknown">("unknown");
  const gaId = tenant.brand.analytics?.gaId;
  const pixel = tenant.id === DEFAULT_TENANT.id;

  useEffect(() => {
    const saved = readConsent();
    setChoice(saved);
    if (saved === "granted") loadTrackers({ gaId, pixel });
  }, [gaId, pixel]);

  // A site with nothing to track has nothing to ask about.
  if (choice !== null || (!gaId && !pixel)) return null;

  const decide = (next: Consent) => {
    saveConsent(next);
    setChoice(next);
    if (next === "granted") loadTrackers({ gaId, pixel });
  };

  return (
    <div
      role="dialog"
      aria-label="موافقة على ملفات تعريف الارتباط"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border bg-card p-4 shadow-lg sm:flex-row sm:items-center"
    >
      <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
        بنستخدم أدوات تحليل وقياس إعلانات (Google Analytics وMeta Pixel) عشان نفهم الموقع بيتستخدم
        إزاي ونحسّنه. مش هتشتغل غير لو وافقت.{" "}
        <Link to="/privacy" className="font-medium text-foreground underline underline-offset-4">
          سياسة الخصوصية
        </Link>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={() => decide("granted")}>
          موافق
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide("denied")}>
          لا، شكرًا
        </Button>
      </div>
    </div>
  );
}
