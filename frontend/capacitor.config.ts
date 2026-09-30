import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native apps package the static build in dist-mobile/client (see
 * vite.config.mobile.ts) and load it locally — they do NOT point a WebView at
 * egxpert.com. Only the API lives on the network.
 *
 * Identity is configurable so a white-label build can be produced without
 * editing source: CAP_APP_ID, CAP_APP_NAME. After changing the app id on an
 * existing project, see docs/mobile-environment.md ("Changing the bundle id").
 */
const appId = process.env["CAP_APP_ID"] ?? "com.egxpert.app";
const appName = process.env["CAP_APP_NAME"] ?? "EGXpert";

// Live-reload against a dev server on the LAN. Never honoured for a production build.
const devServer = process.env["CAP_DEV_SERVER_URL"];
const isProd = (process.env["VITE_APP_ENV"] ?? "production") === "production";

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: "dist-mobile/client",
  backgroundColor: "#ffffff",
  server: {
    // Android serves the bundle from https://localhost (a secure context); iOS from capacitor://localhost.
    androidScheme: "https",
    iosScheme: "capacitor",
    ...(devServer && !isProd ? { url: devServer, cleartext: devServer.startsWith("http://") } : {}),
  },
  // Avoids a SwiftPM package-identity collision with the Firebase plugin (see its README).
  experimental: { ios: { spm: { packageOptions: { "@capacitor-firebase/messaging": { symlink: true } } } } },
  ios: { contentInset: "never", scrollEnabled: true },
  android: { allowMixedContent: !isProd, webContentsDebuggingEnabled: !isProd },
  plugins: {
    SplashScreen: {
      // Hidden by initNativeShell() once the first screen has rendered.
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    Keyboard: { resize: "body", resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
    FirebaseMessaging: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
