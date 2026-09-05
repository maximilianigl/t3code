import { useEffect, useRef } from "react";

import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { useClientSettings, useClientSettingsHydrated } from "../../hooks/useSettings";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "../../state/entities";
import {
  DesktopNotificationTransitionTracker,
  shouldDeliverDesktopNotifications,
} from "./DesktopNotificationCoordinator.logic";

const LOG_SCOPE = "[DESKTOP_NOTIFICATIONS]";

export function DesktopNotificationCoordinator() {
  const threads = useThreadShells();
  const shellsBootstrapped = useAllEnvironmentShellsBootstrapped();
  const settingsHydrated = useClientSettingsHydrated();
  const enabled = useClientSettings((settings) => settings.desktopNotificationsEnabled);
  const trackerRef = useRef(new DesktopNotificationTransitionTracker());
  const showNotification = window.desktopBridge?.showNotification;

  useEffect(() => {
    const tracker = trackerRef.current;
    if (!settingsHydrated || !shellsBootstrapped || showNotification === undefined) {
      tracker.reset();
      return;
    }

    const notifications = tracker.update(threads);
    if (
      !shouldDeliverDesktopNotifications({
        enabled,
        documentFocused: document.hasFocus(),
      })
    ) {
      return;
    }

    for (const notification of notifications) {
      void showNotification(notification).catch((error) => {
        console.error(`${LOG_SCOPE} show failed`, safeErrorLogAttributes(error));
      });
    }
  }, [enabled, settingsHydrated, shellsBootstrapped, showNotification, threads]);

  return null;
}
