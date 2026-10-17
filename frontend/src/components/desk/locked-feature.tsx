import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { Panel } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import type { FeatureLock } from "@/lib/feature-lock";

function UpgradeHint({ lock, label }: { lock: FeatureLock; label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <Lock className="size-5 text-muted-foreground" />
      <p className="text-[14px] font-medium">{label} مش متاحة في باقتك الحالية</p>
      {lock.upgradeTo && (
        <p className="text-[12.5px] text-muted-foreground">رقّي لـ{lock.upgradeTo} عشان تفتحها.</p>
      )}
      <Button asChild size="sm">
        <Link to="/subscribe">شوف الباقات</Link>
      </Button>
    </div>
  );
}

/** Stands in for a desk panel the tier is locked out of, so users can see what a higher tier adds. */
export function LockedPanel({ title, lock }: { title: string; lock: FeatureLock }) {
  return (
    <Panel title={title}>
      <UpgradeHint lock={lock} label="الميزة دي" />
    </Panel>
  );
}

/** Replaces a whole page the tier is locked out of. */
export function LockedPage({ title, lock }: { title: string; lock: FeatureLock }) {
  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <UpgradeHint lock={lock} label={title} />
    </section>
  );
}
