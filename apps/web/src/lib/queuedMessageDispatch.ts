import type { ChatAttachment, UploadChatAttachment } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommand,
  type AtomCommandResult,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import {
  isThreadBusyForQueuedMessage,
  QUEUED_SEND_ADOPTION_MAX_MS,
  type QueuedSendPending,
  type QueuedTurnObservation,
  queuedTurnEnding,
  readFileAsDataUrl,
  resolveQueuedSendOutcome,
  resolveThreadMetadataUpdateForNextTurn,
} from "../components/ChatView.logic";
import { fileAttachmentCapabilityBlockReason } from "../components/chat/composerAttachmentFiles";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { type QueuedComposerMessage, useQueuedMessagesStore } from "../queuedMessagesStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { derivePhase } from "../session-logic";
import { environmentServerConfigsAtom } from "../state/server";
import { environmentThreadShells, threadEnvironment } from "../state/threads";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "./attachmentUploadQueue";
import { newMessageId } from "./utils";

/**
 * Sends whose start command was accepted but whose turn the shell has not
 * shown yet. Until it does, the thread still looks idle and would let the next
 * entry through. Resolved by `observeQueuedThread`.
 */
const pendingSendByThreadKey = new Map<string, QueuedSendPending>();
/** Last seen turn per thread with a queue, for detecting a Stop or a failed turn while queued. */
const turnObservationByThreadKey = new Map<string, QueuedTurnObservation>();

const TURN_ENDING_PAUSE_REASONS = {
  stopped: "Paused because the agent was stopped.",
  failed: "Paused because the agent's turn failed.",
} as const;

function readShell(entry: QueuedComposerMessage): EnvironmentThreadShell | null {
  return appAtomRegistry.get(
    environmentThreadShells.threadShellAtom(scopeThreadRef(entry.environmentId, entry.threadId)),
  );
}

/**
 * Feeds the latest shell into the per-thread bookkeeping and reports whether
 * the queue must pause: the user stopped the agent, its turn failed, or the
 * last queued send never became a turn. Call once per thread per check,
 * before dispatching.
 */
export function observeQueuedThread(
  threadKey: string,
  shell: EnvironmentThreadShell | null,
): string | null {
  if (!shell) return null;
  let pauseReason: string | null = null;
  const next: QueuedTurnObservation = {
    turnId: shell.latestTurn?.turnId ?? null,
    state: shell.latestTurn?.state ?? null,
  };
  const ending = queuedTurnEnding(turnObservationByThreadKey.get(threadKey), next);
  if (ending !== null) pauseReason = TURN_ENDING_PAUSE_REASONS[ending];
  turnObservationByThreadKey.set(threadKey, next);

  const pending = pendingSendByThreadKey.get(threadKey);
  if (pending) {
    const outcome = resolveQueuedSendOutcome(pending, shell, Date.now());
    if (outcome.kind !== "waiting") pendingSendByThreadKey.delete(threadKey);
    if (outcome.kind === "failed") pauseReason ??= outcome.reason;
  }
  return pauseReason;
}

/**
 * Drops bookkeeping for threads whose queue emptied, so an old baseline cannot
 * pause a future queue. A pending send outlives its queue only for the grace
 * window: that still catches a message queued right behind the last one, while
 * an older leftover would only replay a stale failure onto the next queue.
 */
export function pruneQueuedThreadObservations(
  activeThreadKeys: ReadonlySet<string>,
  nowMs = Date.now(),
): void {
  for (const threadKey of turnObservationByThreadKey.keys()) {
    if (!activeThreadKeys.has(threadKey)) turnObservationByThreadKey.delete(threadKey);
  }
  for (const [threadKey, pending] of pendingSendByThreadKey) {
    if (
      !activeThreadKeys.has(threadKey) &&
      nowMs - pending.sentAtMs > QUEUED_SEND_ADOPTION_MAX_MS
    ) {
      pendingSendByThreadKey.delete(threadKey);
    }
  }
}

/** When the oldest unadopted send hits its grace deadline, or null if none is pending. */
export function nextQueuedSendDeadlineMs(): number | null {
  let earliest: number | null = null;
  for (const pending of pendingSendByThreadKey.values()) {
    const deadline = pending.sentAtMs + QUEUED_SEND_ADOPTION_MAX_MS;
    if (earliest === null || deadline < earliest) earliest = deadline;
  }
  return earliest;
}

/**
 * Whether the head of a thread's queue may be sent right now: nothing is
 * already sending or awaiting adoption for the thread, the environment is
 * connected, and the agent no longer owns the thread. The caller passes the
 * values it subscribed to so the decision is made on exactly the state that
 * triggered the check.
 */
export function canDispatchQueuedMessageNow(
  entry: QueuedComposerMessage,
  context: {
    readonly shell: EnvironmentThreadShell | null | undefined;
    readonly connectionPhase: EnvironmentConnectionPhase | undefined;
    readonly sendingMessageId: string | undefined;
  },
): boolean {
  const threadKey = scopedThreadKey(entry);
  if (context.sendingMessageId !== undefined) return false;
  if (context.connectionPhase !== "connected") return false;
  const shell = context.shell;
  if (!shell) return false;
  return !isThreadBusyForQueuedMessage({
    phase: derivePhase(shell.session),
    latestTurn: shell.latestTurn,
    session: shell.session,
    latestUserMessageAt: shell.latestUserMessageAt,
    isSendBusy: pendingSendByThreadKey.has(threadKey),
    hasPendingApproval: shell.hasPendingApprovals,
    hasPendingUserInput: shell.hasPendingUserInput,
    now: new Date().toISOString(),
  });
}

function failureToError(result: AtomCommandResult<unknown, unknown>): Error {
  if (isAtomCommandInterrupted(result)) return new Error("Sending was interrupted.");
  const cause = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
  return cause instanceof Error ? cause : new Error("Failed to send queued message.");
}

async function runOrThrow<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await runAtomCommand(appAtomRegistry, command, input, { reportFailure: false });
  if (result._tag === "Failure") throw failureToError(result);
  return result.value;
}

/** Mirrors the composer's pre-send settings sync so the turn runs with the mode and model chosen when the message was queued. */
async function syncThreadSettings(
  entry: QueuedComposerMessage,
  shell: EnvironmentThreadShell,
  createdAt: string,
): Promise<void> {
  const { environmentId, threadId } = entry;
  const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
    currentModelSelection: shell.modelSelection,
    nextModelSelection: entry.modelSelection,
    currentBranch: shell.branch,
  });
  if (metadataUpdate) {
    await runOrThrow(threadEnvironment.updateMetadata, {
      environmentId,
      input: { threadId, ...metadataUpdate },
    });
  }
  if (entry.runtimeMode !== shell.runtimeMode) {
    await runOrThrow(threadEnvironment.setRuntimeMode, {
      environmentId,
      input: { threadId, runtimeMode: entry.runtimeMode, createdAt },
    });
  }
  if (entry.interactionMode !== shell.interactionMode) {
    await runOrThrow(threadEnvironment.setInteractionMode, {
      environmentId,
      input: { threadId, interactionMode: entry.interactionMode, createdAt },
    });
  }
}

/** Uploads when the environment supports it, otherwise inlines images; files need uploads. */
async function resolveAttachments(
  entry: QueuedComposerMessage,
): Promise<Array<ChatAttachment | UploadChatAttachment>> {
  const all = [...entry.images, ...entry.files];
  if (all.length === 0) return [];
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(entry.environmentId) ?? null;
  const supportsUploads = config?.environment.capabilities.attachmentUploads === true;
  const blockReason = fileAttachmentCapabilityBlockReason({
    files: entry.files,
    attachmentUploadsCapabilityKnown: config !== null,
    supportsAttachmentUploads: supportsUploads,
    maxFileAttachmentBytes:
      config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
  });
  if (blockReason !== null) throw new Error(blockReason);
  if (supportsUploads) {
    for (const attachment of all) {
      startAttachmentUpload({ environmentId: entry.environmentId, image: attachment });
    }
    await awaitAttachmentUploads(all.map((attachment) => attachment.id));
    const uploaded = getUploadedAttachments({ environmentId: entry.environmentId, images: all });
    if (uploaded === null) throw new Error("An attachment failed to upload.");
    return uploaded;
  }
  return Promise.all(
    entry.images.map(async (image) => ({
      type: "image" as const,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: await readFileAsDataUrl(image.file),
    })),
  );
}

/**
 * Sends one queued entry as a new turn on its thread, independent of which
 * thread is on screen. On success the entry leaves the queue; on failure it
 * stays at its position, marked failed, which pauses the rest of that queue.
 */
export async function dispatchQueuedMessage(entry: QueuedComposerMessage): Promise<void> {
  const threadKey = scopedThreadKey(entry);
  const store = useQueuedMessagesStore.getState();
  if (store.sendingByThreadKey[threadKey]) return;
  const shell = readShell(entry);
  if (!shell) {
    store.markFailed(threadKey, entry.id, "This thread is no longer available.");
    return;
  }
  store.setSending(threadKey, entry.id);
  try {
    const createdAt = new Date().toISOString();
    await syncThreadSettings(entry, shell, createdAt);
    const attachments = await resolveAttachments(entry);
    const sentAt = new Date().toISOString();
    // Snapshot right before sending: settings sync above may have moved the shell.
    const shellBeforeSend = readShell(entry) ?? shell;
    // "Send now" into a running turn is a steer. Providers fold it into that
    // turn without opening a new one, so waiting for a new turn id would only
    // end in a false "not picked up" failure.
    const steering =
      derivePhase(shellBeforeSend.session) !== "disconnected" &&
      shellBeforeSend.latestTurn?.state === "running";
    if (!steering) {
      pendingSendByThreadKey.set(threadKey, {
        latestTurnIdBefore: shellBeforeSend.latestTurn?.turnId ?? null,
        sessionUpdatedAtBefore: shellBeforeSend.session?.updatedAt ?? null,
        sentAtMs: Date.now(),
      });
    }
    try {
      await runOrThrow(threadEnvironment.startTurn, {
        environmentId: entry.environmentId,
        input: {
          threadId: entry.threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: entry.outgoingText,
            attachments,
          },
          modelSelection: entry.modelSelection,
          runtimeMode: entry.runtimeMode,
          interactionMode: entry.interactionMode,
          createdAt: sentAt,
        },
      });
    } catch (error) {
      pendingSendByThreadKey.delete(threadKey);
      throw error;
    }
    useQueuedMessagesStore.getState().remove(threadKey, entry.id);
    releaseDraftAttachments(all(entry));
  } catch (error) {
    pauseQueuedThread(
      threadKey,
      entry.id,
      error instanceof Error ? error.message : "Failed to send queued message.",
      shell.title,
    );
  } finally {
    useQueuedMessagesStore.getState().setSending(threadKey, null);
  }
}

/**
 * Marks the head failed, which pauses everything behind it, and says so in a
 * toast: the row list is only visible on that thread, and the user may be
 * looking at another one.
 */
export function pauseQueuedThread(
  threadKey: string,
  headMessageId: string,
  reason: string,
  threadTitle: string,
): void {
  useQueuedMessagesStore.getState().markFailed(threadKey, headMessageId, reason);
  toastManager.add(
    stackedThreadToast({
      type: "warning",
      title: "Message queue paused",
      description: `${threadTitle}: ${reason}`,
    }),
  );
}

function all(entry: QueuedComposerMessage) {
  return [...entry.images, ...entry.files];
}
