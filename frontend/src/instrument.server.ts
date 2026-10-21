// Sentry for the SSR server (node .output/server/index.mjs). Imported first by
// src/server.ts so it initializes before the app's own modules load.
//
// The DSN is not a secret; SENTRY_DSN overrides it and SENTRY_DSN= (empty)
// turns reporting off.
import * as Sentry from "@sentry/tanstackstart-react";

const env = process.env;

Sentry.init({
  dsn:
    env["SENTRY_DSN"] ??
    "https://a8b94e7b5910a392bd249be8ec7cad70@o4512295850541056.ingest.de.sentry.io/4512295924006992",
  environment: env["SENTRY_ENVIRONMENT"] ?? env["NODE_ENV"] ?? "development",
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
  },
  tracesSampleRate: env["NODE_ENV"] === "production" ? 0.1 : 1.0,
});
