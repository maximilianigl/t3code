import { beforeEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { type QueuedComposerMessage, useQueuedMessagesStore } from "./queuedMessagesStore";

function makeMessage(
  id: string,
  overrides: Partial<QueuedComposerMessage> = {},
): QueuedComposerMessage {
  return {
    id,
    createdAt: "2026-09-07T10:00:00.000Z",
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make("thread-1"),
    prompt: `prompt ${id}`,
    images: [],
    files: [],
    terminalContexts: [],
    elementContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    outgoingText: `prompt ${id}`,
    modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5"),
    runtimeMode: "full-access",
    interactionMode: "default",
    failureMessage: null,
    ...overrides,
  };
}

const THREAD = "env-1:thread-1";

describe("queuedMessagesStore", () => {
  beforeEach(() => {
    useQueuedMessagesStore.setState({ queuesByThreadKey: {}, sendingByThreadKey: {} });
  });

  it("keeps entries in enqueue order per thread", () => {
    const store = useQueuedMessagesStore.getState();
    store.enqueue(THREAD, makeMessage("a"));
    store.enqueue(THREAD, makeMessage("b"));
    store.enqueue("env-1:thread-2", makeMessage("c"));

    const queues = useQueuedMessagesStore.getState().queuesByThreadKey;
    expect(queues[THREAD]?.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(queues["env-1:thread-2"]?.map((entry) => entry.id)).toEqual(["c"]);
  });

  it("removes entries and drops the thread key once empty", () => {
    const store = useQueuedMessagesStore.getState();
    store.enqueue(THREAD, makeMessage("a"));
    store.enqueue(THREAD, makeMessage("b"));

    expect(store.remove(THREAD, "a")?.id).toBe("a");
    expect(useQueuedMessagesStore.getState().queuesByThreadKey[THREAD]?.map((e) => e.id)).toEqual([
      "b",
    ]);
    expect(store.remove(THREAD, "missing")).toBeNull();
    store.remove(THREAD, "b");
    expect(useQueuedMessagesStore.getState().queuesByThreadKey[THREAD]).toBeUndefined();
  });

  it("marks and clears failures in place without reordering", () => {
    const store = useQueuedMessagesStore.getState();
    store.enqueue(THREAD, makeMessage("a"));
    store.enqueue(THREAD, makeMessage("b"));
    store.markFailed(THREAD, "a", "too long");
    const queue = useQueuedMessagesStore.getState().queuesByThreadKey[THREAD] ?? [];
    expect(queue.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(queue[0]?.failureMessage).toBe("too long");
    store.clearFailure(THREAD, "a");
    expect(useQueuedMessagesStore.getState().queuesByThreadKey[THREAD]?.[0]?.failureMessage).toBe(
      null,
    );
  });

  it("tracks at most one sending entry per thread", () => {
    const store = useQueuedMessagesStore.getState();
    store.setSending(THREAD, "a");
    expect(useQueuedMessagesStore.getState().sendingByThreadKey[THREAD]).toBe("a");
    store.setSending(THREAD, null);
    expect(useQueuedMessagesStore.getState().sendingByThreadKey[THREAD]).toBeUndefined();
  });
});
