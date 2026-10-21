import * as Sentry from "@sentry/tanstackstart-react";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// The alytic-frontend project's DSN. Not a secret — every visitor's browser has it.
const SENTRY_DSN =
  "https://a8b94e7b5910a392bd249be8ec7cad70@o4512295850541056.ingest.de.sentry.io/4512295924006992";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  // getRouter runs once per SSR request too; the server is initialized in
  // src/instrument.server.ts instead.
  if (!router.isServer && !Sentry.getClient()) {
    Sentry.init({
      dsn: SENTRY_DSN,
      enabled: import.meta.env.MODE !== "test",
      environment: import.meta.env.PROD ? "production" : "development",
      // Portfolios and form input stay out of Sentry; replays mask all text too.
      dataCollection: {
        userInfo: false,
        httpBodies: [],
      },
      integrations: [
        Sentry.tanstackRouterBrowserTracingIntegration(router),
        Sentry.replayIntegration(),
      ],
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
      // Traces continue into the Express API (same origin through /api/public).
      tracePropagationTargets: [/^\//],
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  }

  return router;
};
