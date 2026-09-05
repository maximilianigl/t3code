import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const { NotificationMock, instances, isSupportedMock } = vi.hoisted(() => {
  const instances: Array<{
    options: { title: string; body: string };
    close: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    listeners: Map<string, () => void>;
  }> = [];
  const isSupportedMock = vi.fn(() => true);

  class NotificationMock {
    static isSupported = isSupportedMock;
    readonly close = vi.fn();
    readonly show = vi.fn();
    readonly listeners = new Map<string, () => void>();
    readonly options: { title: string; body: string };

    constructor(options: { title: string; body: string }) {
      this.options = options;
      instances.push(this);
    }

    once(event: string, listener: () => void) {
      this.listeners.set(event, listener);
      return this;
    }
  }

  return { NotificationMock, instances, isSupportedMock };
});

vi.mock("electron", () => ({ Notification: NotificationMock }));

import * as ElectronNotification from "./ElectronNotification.ts";

describe("ElectronNotification", () => {
  beforeEach(() => {
    instances.length = 0;
    isSupportedMock.mockReset();
    isSupportedMock.mockReturnValue(true);
  });

  it.effect("shows a native notification and forwards its click", () => {
    const onClick = vi.fn();

    return Effect.gen(function* () {
      const notifications = yield* ElectronNotification.ElectronNotification;
      const shown = yield* notifications.show(
        { id: "notice-1", title: "Thread title", body: "Agent finished working." },
        onClick,
      );

      assert.isTrue(shown);
      assert.strictEqual(instances.length, 1);
      assert.deepEqual(instances[0]?.options, {
        title: "Thread title",
        body: "Agent finished working.",
      });
      assert.strictEqual(instances[0]?.show.mock.calls.length, 1);

      instances[0]?.listeners.get("click")?.();
      assert.strictEqual(onClick.mock.calls.length, 1);
    }).pipe(Effect.provide(ElectronNotification.layer));
  });

  it.effect("reports unsupported native notifications without creating one", () => {
    isSupportedMock.mockReturnValue(false);

    return Effect.gen(function* () {
      const notifications = yield* ElectronNotification.ElectronNotification;
      const shown = yield* notifications.show(
        { id: "notice-1", title: "Thread title", body: "Agent finished working." },
        vi.fn(),
      );

      assert.isFalse(shown);
      assert.isEmpty(instances);
    }).pipe(Effect.provide(ElectronNotification.layer));
  });

  it.effect("closes an older notification with the same id", () =>
    Effect.gen(function* () {
      const notifications = yield* ElectronNotification.ElectronNotification;
      const input = { id: "notice-1", title: "Thread title", body: "Approval needed." };

      yield* notifications.show(input, vi.fn());
      yield* notifications.show(input, vi.fn());

      assert.strictEqual(instances[0]?.close.mock.calls.length, 1);
      assert.strictEqual(instances.length, 2);
    }).pipe(Effect.provide(ElectronNotification.layer)),
  );
});
