import { DesktopNotificationInputSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppActivation from "../../app/DesktopAppActivation.ts";
import * as ElectronNotification from "../../electron/ElectronNotification.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const showNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SHOW_NOTIFICATION_CHANNEL,
  payload: DesktopNotificationInputSchema,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.notifications.show")(function* (input) {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const notifications = yield* ElectronNotification.ElectronNotification;
    const activation = yield* DesktopAppActivation.DesktopAppActivation;

    return yield* notifications.show(input, () => {
      void runPromise(
        activation
          .request({
            version: 1,
            requestId: `desktop-notification:${input.id}`,
            type: "open-thread",
            environmentId: input.environmentId,
            threadId: input.threadId,
          })
          .pipe(Effect.asVoid),
      );
    });
  }),
});
