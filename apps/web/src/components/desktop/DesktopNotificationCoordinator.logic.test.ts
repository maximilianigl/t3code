import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DesktopNotificationTransitionTracker,
  shouldDeliverDesktopNotifications,
  type DesktopNotificationThreadState,
} from "./DesktopNotificationCoordinator.logic";

const baseThread: DesktopNotificationThreadState = {
  environmentId: EnvironmentId.make("primary"),
  id: ThreadId.make("thread-1"),
  title: "Fix notifications",
  updatedAt: "2026-09-05T10:00:00.000Z",
  archivedAt: null,
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "running",
  },
  hasPendingApprovals: false,
  hasPendingUserInput: false,
};

describe("DesktopNotificationTransitionTracker", () => {
  it("delivers only while enabled and unfocused", () => {
    expect(shouldDeliverDesktopNotifications({ enabled: true, documentFocused: false })).toBe(true);
    expect(shouldDeliverDesktopNotifications({ enabled: true, documentFocused: true })).toBe(false);
    expect(shouldDeliverDesktopNotifications({ enabled: false, documentFocused: false })).toBe(
      false,
    );
  });

  it("uses the first snapshot as a baseline", () => {
    const tracker = new DesktopNotificationTransitionTracker();

    expect(
      tracker.update([
        { ...baseThread, latestTurn: { ...baseThread.latestTurn!, state: "completed" } },
      ]),
    ).toEqual([]);
  });

  it.each([
    ["completed", "Agent finished working."],
    ["error", "Agent stopped with an error."],
  ] as const)("notifies when a running turn becomes %s", (state, body) => {
    const tracker = new DesktopNotificationTransitionTracker();
    tracker.update([baseThread]);

    const notifications = tracker.update([
      {
        ...baseThread,
        updatedAt: "2026-09-05T10:01:00.000Z",
        latestTurn: { ...baseThread.latestTurn!, state },
      },
    ]);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: "Fix notifications",
      body,
      environmentId: "primary",
      threadId: "thread-1",
    });
    expect(tracker.update([])).toEqual([]);
  });

  it.each([
    ["hasPendingApprovals", "Approval needed."],
    ["hasPendingUserInput", "Your input is needed."],
  ] as const)("notifies when %s becomes true", (field, body) => {
    const tracker = new DesktopNotificationTransitionTracker();
    tracker.update([baseThread]);

    const notifications = tracker.update([
      { ...baseThread, [field]: true, updatedAt: "2026-09-05T10:01:00.000Z" },
    ]);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.body).toBe(body);
    expect(tracker.update([{ ...baseThread, [field]: true }])).toEqual([]);
  });

  it("does not notify when a historical thread appears or after a reset", () => {
    const tracker = new DesktopNotificationTransitionTracker();
    tracker.update([baseThread]);
    expect(
      tracker.update([
        baseThread,
        {
          ...baseThread,
          id: ThreadId.make("thread-2"),
          latestTurn: { turnId: TurnId.make("turn-old"), state: "completed" },
        },
      ]),
    ).toEqual([]);

    tracker.reset();
    expect(
      tracker.update([
        { ...baseThread, latestTurn: { ...baseThread.latestTurn!, state: "completed" } },
      ]),
    ).toEqual([]);
  });

  it("prefers an approval notification over a simultaneous completion", () => {
    const tracker = new DesktopNotificationTransitionTracker();
    tracker.update([baseThread]);

    const notifications = tracker.update([
      {
        ...baseThread,
        hasPendingApprovals: true,
        latestTurn: { ...baseThread.latestTurn!, state: "completed" },
      },
    ]);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.body).toBe("Approval needed.");
  });

  it("does not notify twice when one turn changes between terminal states", () => {
    const tracker = new DesktopNotificationTransitionTracker();
    tracker.update([baseThread]);
    tracker.update([{ ...baseThread, latestTurn: { ...baseThread.latestTurn!, state: "error" } }]);

    expect(
      tracker.update([
        { ...baseThread, latestTurn: { ...baseThread.latestTurn!, state: "completed" } },
      ]),
    ).toEqual([]);
  });
});
