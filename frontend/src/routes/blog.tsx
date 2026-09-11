import { Outlet, createFileRoute } from "@tanstack/react-router";

import { SiteShell } from "@/components/marketing/site-shell";

// Shared layout for /blog and /blog/$slug. Both child routes render inside
// SiteShell via this Outlet — without it, the child route has nowhere to
// mount and this layout's own component would render in its place instead
// (verified live: /blog/:slug was rendering blog.index.tsx's list page).
export const Route = createFileRoute("/blog")({
  component: () => (
    <SiteShell>
      <Outlet />
    </SiteShell>
  ),
});
