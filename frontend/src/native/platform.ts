import { Capacitor } from "@capacitor/core";

/**
 * True only inside the Android / iOS shells. The website, the dev server and
 * the test runner are all "web". Everything native-only is gated on this so
 * the browser build behaves exactly as it did before Capacitor was added.
 */
export const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export type NativePlatform = "android" | "ios" | "web";

export const nativePlatform = (): NativePlatform => {
  try {
    const name = Capacitor.getPlatform();
    return name === "android" || name === "ios" ? name : "web";
  } catch {
    return "web";
  }
};
