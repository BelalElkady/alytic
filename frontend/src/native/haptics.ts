import { isNative } from "./platform";

type Kind = "light" | "medium" | "success" | "warning" | "error";

/** Small physical confirmation for taps and outcomes. A no-op in browsers and when the device has no haptic engine. */
export async function haptic(kind: Kind = "light"): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    if (kind === "light") await Haptics.impact({ style: ImpactStyle.Light });
    else if (kind === "medium") await Haptics.impact({ style: ImpactStyle.Medium });
    else
      await Haptics.notification({
        type: kind === "success" ? NotificationType.Success : kind === "warning" ? NotificationType.Warning : NotificationType.Error,
      });
  } catch {
    // Haptics are a nicety, never a failure.
  }
}
