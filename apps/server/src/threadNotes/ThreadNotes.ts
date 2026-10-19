import { ThreadNotesError, type ThreadId, type ThreadNotes as Notes } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

const EMPTY_NOTES: Notes = { markdown: "", updatedAt: null };

/** The user's per-thread Markdown scratch pad. Agents never read it. */
export class ThreadNotes extends Context.Service<
  ThreadNotes,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<Notes, ThreadNotesError>;
    /** Replaces the notes; empty Markdown removes them. */
    readonly set: (input: {
      readonly threadId: ThreadId;
      readonly markdown: string;
    }) => Effect.Effect<Notes, ThreadNotesError>;
  }
>()("t3/threadNotes/ThreadNotes") {}

export const layer = Layer.effect(
  ThreadNotes,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    // Fork-only table, so it cannot take a migration id: the migrator skips every id up to the
    // highest recorded one, and a fork id would make it skip upstream's next migration.
    yield* sql`
      CREATE TABLE IF NOT EXISTS thread_notes (
        thread_id TEXT PRIMARY KEY NOT NULL,
        markdown TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID
    `;

    const get = Effect.fn("ThreadNotes.get")(function* (threadId: ThreadId) {
      const rows = yield* sql<Notes>`
        SELECT markdown, updated_at AS "updatedAt"
        FROM thread_notes
        WHERE thread_id = ${threadId}
      `.pipe(Effect.mapError((cause) => new ThreadNotesError({ threadId, cause })));
      return rows[0] ?? EMPTY_NOTES;
    });

    const set = Effect.fn("ThreadNotes.set")(function* (input: {
      readonly threadId: ThreadId;
      readonly markdown: string;
    }) {
      const fail = (cause: unknown) => new ThreadNotesError({ threadId: input.threadId, cause });
      if (input.markdown.trim() === "") {
        yield* sql`DELETE FROM thread_notes WHERE thread_id = ${input.threadId}`.pipe(
          Effect.mapError(fail),
        );
        return EMPTY_NOTES;
      }
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO thread_notes (thread_id, markdown, updated_at)
        VALUES (${input.threadId}, ${input.markdown}, ${updatedAt})
        ON CONFLICT(thread_id) DO UPDATE SET
          markdown = excluded.markdown,
          updated_at = excluded.updated_at
      `.pipe(Effect.mapError(fail));
      return { markdown: input.markdown, updatedAt };
    });

    return ThreadNotes.of({ get, set });
  }),
);
