import { createFileRoute, redirect } from "@tanstack/react-router";

// Public alias used by app/notification links: targets, stops and alerts live on /targets.
export const Route = createFileRoute("/alerts")({
  beforeLoad: () => {
    throw redirect({ to: "/targets", replace: true });
  },
});
