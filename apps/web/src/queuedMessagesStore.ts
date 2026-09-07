import type {
  EnvironmentId,
  ModelSelection,
  PreviewAnnotationPayload,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";

import type { ComposerFileAttachment, ComposerImageAttachment } from "./composerDraftStore";
import type { ElementContextDraft } from "./lib/elementContext";
import type { TerminalContextDraft } from "./lib/terminalContext";
import type { ReviewCommentContext } from "./reviewCommentContext";

/**
 * A composer snapshot waiting for the agent to finish its current turn.
 *
 * The entry carries both the editable pieces (prompt, attachments, contexts)
 * so it can move back into the composer, and the resolved send (`outgoingText`
 * plus the thread settings chosen at the time) so an app-level drain can send
 * it without the composer being on screen. The outgoing text depends only on
 * what was typed and attached, never on the agent's reply, so resolving it at
 * enqueue time loses nothing.
 */
export interface QueuedComposerMessage {
  readonly id: string;
  readonly createdAt: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly prompt: string;
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly files: ReadonlyArray<ComposerFileAttachment>;
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
  readonly elementContexts: ReadonlyArray<ElementContextDraft>;
  readonly previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  /** Final provider input: prompt with contexts appended and provider formatting applied. */
  readonly outgoingText: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  /**
   * Set when an automatic send of this entry failed. A failed entry at the
   * head pauses the queue (later entries never jump ahead of it) until the
   * user retries or removes it.
   */
  readonly failureMessage: string | null;
}

export const EMPTY_QUEUED_MESSAGES: ReadonlyArray<QueuedComposerMessage> = Object.freeze([]);

interface QueuedMessagesStoreState {
  /** FIFO per scoped thread key. Only server threads can hold a queue. */
  queuesByThreadKey: Record<string, ReadonlyArray<QueuedComposerMessage>>;
  /** Entry currently being sent for a thread; at most one per thread. */
  sendingByThreadKey: Record<string, string>;
  enqueue: (threadKey: string, message: QueuedComposerMessage) => void;
  /** Removes the entry and returns it so the caller can release its resources or restore it. */
  remove: (threadKey: string, messageId: string) => QueuedComposerMessage | null;
  markFailed: (threadKey: string, messageId: string, failureMessage: string) => void;
  clearFailure: (threadKey: string, messageId: string) => void;
  setSending: (threadKey: string, messageId: string | null) => void;
}

/**
 * Queued messages live in memory only. Images carry `File` handles that do
 * not serialize, so a persisted copy could only resurrect text. Losing the
 * queue on reload is the honest failure mode for now.
 */
export const useQueuedMessagesStore = create<QueuedMessagesStoreState>()((set, get) => ({
  queuesByThreadKey: {},
  sendingByThreadKey: {},
  enqueue: (threadKey, message) => {
    set((state) => ({
      queuesByThreadKey: {
        ...state.queuesByThreadKey,
        [threadKey]: [...(state.queuesByThreadKey[threadKey] ?? []), message],
      },
    }));
  },
  remove: (threadKey, messageId) => {
    const queue = get().queuesByThreadKey[threadKey] ?? EMPTY_QUEUED_MESSAGES;
    const entry = queue.find((candidate) => candidate.id === messageId) ?? null;
    if (!entry) return null;
    set((state) => {
      const remaining = (state.queuesByThreadKey[threadKey] ?? []).filter(
        (candidate) => candidate.id !== messageId,
      );
      const next = { ...state.queuesByThreadKey };
      if (remaining.length === 0) {
        delete next[threadKey];
      } else {
        next[threadKey] = remaining;
      }
      return { queuesByThreadKey: next };
    });
    return entry;
  },
  markFailed: (threadKey, messageId, failureMessage) => {
    set((state) => {
      const queue = state.queuesByThreadKey[threadKey];
      if (!queue?.some((candidate) => candidate.id === messageId)) return state;
      return {
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: queue.map((candidate) =>
            candidate.id === messageId ? { ...candidate, failureMessage } : candidate,
          ),
        },
      };
    });
  },
  clearFailure: (threadKey, messageId) => {
    set((state) => {
      const queue = state.queuesByThreadKey[threadKey];
      if (!queue?.some((candidate) => candidate.id === messageId && candidate.failureMessage)) {
        return state;
      }
      return {
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: queue.map((candidate) =>
            candidate.id === messageId ? { ...candidate, failureMessage: null } : candidate,
          ),
        },
      };
    });
  },
  setSending: (threadKey, messageId) => {
    set((state) => {
      if ((state.sendingByThreadKey[threadKey] ?? null) === messageId) return state;
      const next = { ...state.sendingByThreadKey };
      if (messageId === null) {
        delete next[threadKey];
      } else {
        next[threadKey] = messageId;
      }
      return { sendingByThreadKey: next };
    });
  },
}));
