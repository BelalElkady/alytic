/**
 * Sentry error monitoring + tracing for the API.
 *
 * Must run before express (or anything else Sentry instruments) is imported.
 * server.js imports it first, which is enough for error capture; for full
 * tracing of express/http/fetch, start the process with
 * `node --import ./src/instrument.js src/api/server.js` so the instrumentation
 * hooks are registered before any module is loaded.
 *
 * The DSN is not a secret (it can only submit events), so the alytic-backend
 * project's DSN is the default; SENTRY_DSN overrides it, and SENTRY_DSN= (empty)
 * turns reporting off. `node --test` runs never report.
 *
 * The release is the deployed commit: deploy.yml writes it to $DEPLOY_PATH/COMMIT,
 * two levels above this file on the VPS.
 */
import './loadEnv.js';
import * as Sentry from '@sentry/node';
import { readFileSync } from 'node:fs';

function deployedCommit() {
  try {
    return readFileSync(new URL('../../COMMIT', import.meta.url), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? 'https://e191024527f52f0172c09decdb76bc52@o4512295850541056.ingest.de.sentry.io/4512295923941456',
  enabled: !process.env.NODE_TEST_CONTEXT,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE ?? deployedCommit(),

  // Users' portfolios, emails and phone numbers flow through request bodies —
  // keep bodies, cookies and user info out of Sentry.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
  },

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
