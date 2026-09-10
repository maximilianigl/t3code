import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

export interface ElectronNotificationInput {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export class ElectronNotificationShowError extends Schema.TaggedError<ElectronNotificationShowError>()(
  "ElectronNotificationShowError",
  {
    notificationId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to show desktop notification ${JSON.stringify(this.notificationId)}.`;
  }
}

export class ElectronNotification extends Context.Service<
  ElectronNotification,
  {
    readonly show: (
      input: ElectronNotificationInput,
      onClick: () => void,
    ) => Effect.Effect<boolean, ElectronNotificationShowError>;
  }
>()("@t3tools/desktop/electron/ElectronNotification") {}

export const make = Effect.sync(() => {
  const active = new Map<string, Electron.Notification>();

  return ElectronNotification.of({
    show: (input, onClick) =>
      Effect.try({
        try: () => {
          if (!Electron.Notification.isSupported()) {
            return false;
          }

          active.get(input.id)?.close();
          const notification = new Electron.Notification({
            title: input.title,
            body: input.body,
          });
          active.set(input.id, notification);

          const forget = () => {
            if (active.get(input.id) === notification) {
              active.delete(input.id);
            }
          };
          notification.once("close", forget);
          notification.once("failed", forget);
          notification.once("click", () => {
            forget();
            onClick();
          });
          notification.show();
          return true;
        },
        catch: (cause) => new ElectronNotificationShowError({ notificationId: input.id, cause }),
      }),
  });
});

export const layer = Layer.effect(ElectronNotification, make);
