import { createFileRoute, redirect } from "@tanstack/react-router";

// The public/shareable URL for a stock (https://egxpert.com/stocks/SWDY). It is
// also what the native apps claim as a universal/app link; in a browser it just
// forwards to the page the desk already has.
export const Route = createFileRoute("/stocks/$code")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/stock/$code", params: { code: params.code.toUpperCase() }, replace: true });
  },
});
