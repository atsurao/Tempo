export type PermissionState = "granted" | "denied" | "default" | "unsupported";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Synchronous web check; the desktop shell needs the async variant below. */
export function notificationPermission(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return inTauri() ? "default" : "unsupported";
  }
  return Notification.permission;
}

export async function checkNotificationPermission(): Promise<PermissionState> {
  if (inTauri()) {
    try {
      const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
      return (await isPermissionGranted()) ? "granted" : "default";
    } catch {
      return "unsupported";
    }
  }
  return notificationPermission();
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (inTauri()) {
    try {
      const { isPermissionGranted, requestPermission } = await import(
        "@tauri-apps/plugin-notification"
      );
      if (await isPermissionGranted()) return "granted";
      return (await requestPermission()) === "granted" ? "granted" : "denied";
    } catch {
      return "unsupported";
    }
  }
  if (notificationPermission() === "unsupported") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * Best-effort system notification. In-app toasts are the source of truth;
 * this never throws when the platform refuses to show one.
 */
export function sendSystemNotification(title: string, body: string): void {
  if (inTauri()) {
    void (async () => {
      try {
        const { isPermissionGranted, sendNotification } = await import(
          "@tauri-apps/plugin-notification"
        );
        if (await isPermissionGranted()) sendNotification({ title, body });
      } catch {
        /* ignore */
      }
    })();
    return;
  }

  if (notificationPermission() !== "granted") return;
  try {
    new Notification(title, { body, silent: false });
  } catch {
    /* ignore — in-app toast already covers it */
  }
}
