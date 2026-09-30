import { useSyncExternalStore } from "react";

import { isNative } from "./platform";

/**
 * One place that knows whether the device can reach the network.
 *
 *   ONLINE       — connected and the last reachability check succeeded
 *   OFFLINE      — the OS reports no connection
 *   RECONNECTING — the OS says a connection is back, but we have not yet seen
 *                  the server answer (captive portals and flaky radios report
 *                  "connected" long before requests work)
 */
export type NetworkState = "ONLINE" | "OFFLINE" | "RECONNECTING";

type Listener = () => void;

let state: NetworkState = "ONLINE";
const listeners = new Set<Listener>();
let started = false;
let probe: () => Promise<boolean> = async () => true;

function set(next: NetworkState) {
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export const getNetworkState = (): NetworkState => state;
export const isOnline = () => state === "ONLINE";

export function subscribeNetwork(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A raw "the OS now reports connected" signal. Verifies the server before declaring ONLINE. */
export async function handleConnectivityChange(connected: boolean, retryDelayMs = 2000) {
  if (!connected) return set("OFFLINE");
  if (state === "ONLINE") return;
  set("RECONNECTING");
  if (await probe().catch(() => false)) return set("ONLINE");
  // The OS says connected but the server is unreachable: keep trying rather than claiming ONLINE.
  setTimeout(() => {
    if (state === "RECONNECTING") void handleConnectivityChange(true, Math.min(retryDelayMs * 2, 30_000));
  }, retryDelayMs);
}

/** Starts listening. Safe to call more than once. `healthCheck` should resolve true when the API answers. */
export async function startNetworkMonitor(healthCheck?: () => Promise<boolean>) {
  if (started) return;
  started = true;
  if (healthCheck) probe = healthCheck;

  if (isNative()) {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    set(status.connected ? "ONLINE" : "OFFLINE");
    await Network.addListener("networkStatusChange", (next) => void handleConnectivityChange(next.connected));
  } else if (typeof window !== "undefined") {
    set(navigator.onLine ? "ONLINE" : "OFFLINE");
    window.addEventListener("online", () => void handleConnectivityChange(true));
    window.addEventListener("offline", () => void handleConnectivityChange(false));
  }
}

export function useNetworkState(): NetworkState {
  return useSyncExternalStore(subscribeNetwork, getNetworkState, () => "ONLINE" as NetworkState);
}

/** Test hook. */
export function resetNetworkForTests() {
  state = "ONLINE";
  started = false;
  probe = async () => true;
  listeners.clear();
}
