import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";

import {
  canDispatchQueuedMessageNow,
  dispatchQueuedMessage,
  nextQueuedSendDeadlineMs,
  observeQueuedThread,
  pauseQueuedThread,
  pruneQueuedThreadObservations,
} from "~/lib/queuedMessageDispatch";
import { useQueuedMessagesStore } from "~/queuedMessagesStore";
import { environmentPresentations } from "~/state/presentation";
import { environmentThreadShells } from "~/state/threads";

/**
 * Sends the head of every thread's message queue as soon as that thread is
 * idle and its environment is connected, whether or not the thread is open.
 * Pauses a queue when the user stops its agent, the agent's turn fails, or a
 * sent message never turns into a turn. Mounted once above the router so it
 * keeps running on Settings and other non-chat pages.
 */
export function useQueuedMessageDrain(): void {
  const queues = useQueuedMessagesStore((store) => store.queuesByThreadKey);
  const sending = useQueuedMessagesStore((store) => store.sendingByThreadKey);
  const shells = useAtomValue(environmentThreadShells.threadShellsAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);

  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      pruneQueuedThreadObservations(new Set(Object.keys(queues)));
      for (const queue of Object.values(queues)) {
        const head = queue[0];
        if (!head) continue;
        const threadKey = scopedThreadKey(head);
        const shell = shells.find(
          (candidate) =>
            candidate.environmentId === head.environmentId && candidate.id === head.threadId,
        );
        // Observe every queued thread, paused or not, so the ending baseline
        // stays current while the user sorts out a failed head.
        const pauseReason = observeQueuedThread(threadKey, shell ?? null);
        if (pauseReason !== null && head.failureMessage === null) {
          pauseQueuedThread(threadKey, head.id, pauseReason, shell?.title ?? "Thread");
          continue;
        }
        // Strict FIFO per thread: a failed head pauses everything behind it.
        if (head.failureMessage !== null) continue;
        const dispatchable = canDispatchQueuedMessageNow(head, {
          shell,
          connectionPhase: presentations.get(head.environmentId)?.connection.phase,
          sendingMessageId: sending[threadKey],
        });
        if (dispatchable) void dispatchQueuedMessage(head);
      }
      // A thread whose provider never answers produces no state change, so
      // the adoption deadline needs its own wake-up to be noticed.
      const deadline = nextQueuedSendDeadlineMs();
      if (deadline !== null) {
        timer = window.setTimeout(check, Math.max(0, deadline - Date.now()) + 50);
      }
    };
    check();
    return () => window.clearTimeout(timer);
  }, [presentations, queues, sending, shells]);
}
