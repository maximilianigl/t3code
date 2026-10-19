import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

/** A scratch pad, not a document store: large pastes belong in files. */
export const THREAD_NOTES_MAX_LENGTH = 200_000;

export const ThreadNotesInput = Schema.Struct({
  threadId: ThreadId,
});
export type ThreadNotesInput = typeof ThreadNotesInput.Type;

/** A thread without notes reads as empty Markdown with no update time. */
export const ThreadNotes = Schema.Struct({
  markdown: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
});
export type ThreadNotes = typeof ThreadNotes.Type;

/** Replaces the thread's notes; empty Markdown removes them. */
export const ThreadNotesSetInput = Schema.Struct({
  threadId: ThreadId,
  markdown: Schema.String.check(Schema.isMaxLength(THREAD_NOTES_MAX_LENGTH)),
});
export type ThreadNotesSetInput = typeof ThreadNotesSetInput.Type;

export class ThreadNotesError extends Schema.TaggedError<ThreadNotesError>()("ThreadNotesError", {
  threadId: ThreadId,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return "Could not access this thread's notes.";
  }
}
