import { useEffect, useState } from "react";

const STORAGE_KEY = "alytic-theme";

/** Shared light/dark toggle, backed by localStorage so it's consistent
 * across the marketing site and the signed-in app shell. */
export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const isDark = saved === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);
  const toggle = () => {
    setDark((previous) => {
      const next = !previous;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  };
  return { dark, toggle };
}
