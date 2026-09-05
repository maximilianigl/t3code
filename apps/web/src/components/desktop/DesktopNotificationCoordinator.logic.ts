import type {
  DesktopNotificationInput,
  EnvironmentId,
  OrchestrationLatestTurn,
  ThreadId,
} from "@t3tools/contracts";

export interface DesktopNotificationThreadState {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly latestTurn: Pick<OrchestrationLatestTurn, "state" | "turnId"> | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}

export function shouldDeliverDesktopNotifications(input: {
  readonly enabled: boolean;
  readonly documentFocused: boolean;
}): boolean {
  return input.enabled && !input.documentFocused;
}

function threadKey(thread: DesktopNotificationThreadState): string {
  return `${thread.environmentId}\u0000${thread.id}`;
}

function notification(
  thread: DesktopNotificationThreadState,
  kind: "approval" | "input" | "completed" | "error",
  identity: string,
  body: string,
): DesktopNotificationInput {
  return {
    id: `${kind}:${thread.environmentId}:${thread.id}:${identity}`,
    title: thread.title,
    body,
    environmentId: thread.environmentId,
    threadId: thread.id,
  };
}

export function resolveDesktopNotification(
  previous: DesktopNotificationThreadState,
  current: DesktopNotificationThreadState,
): DesktopNotificationInput | null {
  if (current.archivedAt !== null) return null;

  if (!previous.hasPendingApprovals && current.hasPendingApprovals) {
    return notification(current, "approval", current.updatedAt, "Approval needed.");
  }
  if (!previous.hasPendingUserInput && current.hasPendingUserInput) {
    return notification(current, "input", current.updatedAt, "Your input is needed.");
  }

  const turn = current.latestTurn;
  if (turn === null || (turn.state !== "completed" && turn.state !== "error")) {
    return null;
  }
  const previousTurn = previous.latestTurn;
  if (
    previousTurn?.turnId === turn.turnId &&
    (previousTurn.state === "completed" || previousTurn.state === "error")
  ) {
    return null;
  }
  return turn.state === "error"
    ? notification(current, "error", turn.turnId, "Agent stopped with an error.")
    : notification(current, "completed", turn.turnId, "Agent finished working.");
}

export class DesktopNotificationTransitionTracker {
  readonly #previous = new Map<string, DesktopNotificationThreadState>();
  #initialized = false;

  reset(): void {
    this.#previous.clear();
    this.#initialized = false;
  }

  update(
    threads: ReadonlyArray<DesktopNotificationThreadState>,
  ): ReadonlyArray<DesktopNotificationInput> {
    const next = new Map(threads.map((thread) => [threadKey(thread), thread] as const));
    if (!this.#initialized) {
      this.#initialized = true;
      for (const [key, thread] of next) this.#previous.set(key, thread);
      return [];
    }

    const notifications: DesktopNotificationInput[] = [];
    for (const [key, thread] of next) {
      const previous = this.#previous.get(key);
      if (previous !== undefined) {
        const resolved = resolveDesktopNotification(previous, thread);
        if (resolved !== null) notifications.push(resolved);
      }
    }
    this.#previous.clear();
    for (const [key, thread] of next) this.#previous.set(key, thread);
    return notifications;
  }
}
