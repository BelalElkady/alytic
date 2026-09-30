import { resolveDeepLink } from "./deep-links";
import { isNative } from "./platform";

type Resume = (awayMs: number) => void;
const resumeListeners = new Set<Resume>();

/** Called when the app returns to the foreground; receives how long it was away. */
export function onAppResume(listener: Resume) {
  resumeListeners.add(listener);
  return () => void resumeListeners.delete(listener);
}

/**
 * One-time native shell setup: status bar to match the theme, splash hidden
 * once the UI is ready, keyboard that resizes the body instead of covering
 * inputs, the Android back button, deep links (cold start and while running)
 * and foreground/background tracking. Returns a cleanup function.
 */
export function initNativeShell(navigate: (target: { to: string; search?: Record<string, string> }) => void): () => void {
  if (!isNative()) return () => {};
  document.documentElement.classList.add("native-app");
  const cleanups: Array<() => void> = [];
  let disposed = false;
  const keep = (handle: { remove: () => Promise<void> }) => {
    if (disposed) void handle.remove();
    else cleanups.push(() => void handle.remove());
  };

  void (async () => {
    const [{ App }, { StatusBar, Style }, { SplashScreen }, { Keyboard, KeyboardResize }] = await Promise.all([
      import("@capacitor/app"),
      import("@capacitor/status-bar"),
      import("@capacitor/splash-screen"),
      import("@capacitor/keyboard"),
    ]);

    const applyBars = async () => {
      const dark = document.documentElement.classList.contains("dark");
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
      await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    };
    await applyBars();
    const observer = new MutationObserver(() => void applyBars());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    cleanups.push(() => observer.disconnect());

    await Keyboard.setResizeMode({ mode: KeyboardResize.Body }).catch(() => {});
    await SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});

    // Deep links: the link that launched the app, then any that arrive later.
    const launch = await App.getLaunchUrl();
    const first = resolveDeepLink(launch?.url);
    if (first) navigate(first);
    keep(
      await App.addListener("appUrlOpen", ({ url }) => {
        const target = resolveDeepLink(url);
        if (target) navigate(target);
      }),
    );

    // Android back button: go back in history, leave the app only from the root.
    keep(
      await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack || window.history.length > 1) window.history.back();
        else void App.exitApp();
      }),
    );

    let backgroundedAt: number | null = null;
    keep(
      await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          backgroundedAt = Date.now();
          return;
        }
        const away = backgroundedAt ? Date.now() - backgroundedAt : 0;
        backgroundedAt = null;
        resumeListeners.forEach((listener) => listener(away));
      }),
    );
  })();

  return () => {
    disposed = true;
    cleanups.forEach((fn) => fn());
  };
}
