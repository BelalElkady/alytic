/** A tiny typed event bus so api.ts (no React) can tell the UI the session ended. */
type Listener = () => void;
const listeners = new Set<Listener>();

export const onSessionExpired = (listener: Listener) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const emitSessionExpired = () => listeners.forEach((listener) => listener());
