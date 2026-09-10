import { useEffect, useRef } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined;

let scriptPromise: Promise<void> | null = null;
function loadGoogleScript() {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("google-gsi-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.id = "google-gsi-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("تعذر تحميل خدمة جوجل"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Renders Google's own "Continue with Google" button and hands back the ID-token credential on success. */
export function GoogleSignInButton({
  onCredential,
  onError,
}: {
  onCredential: (credential: string) => void;
  onError?: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Refs so the effect below runs once on mount instead of re-initializing
  // (and duplicating) the button whenever a parent re-render passes new
  // inline callback identities.
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  onCredentialRef.current = onCredential;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (response?.credential) onCredentialRef.current(response.credential);
            else onErrorRef.current?.("تعذر تسجيل الدخول بجوجل");
          },
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          locale: "ar",
          width: 320,
        });
      })
      .catch(() => onErrorRef.current?.("تعذر تحميل خدمة جوجل"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!GOOGLE_CLIENT_ID) return null;

  return <div ref={containerRef} className="flex justify-center [&>div]:w-full" />;
}
