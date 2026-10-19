import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "../persistence/Migrations.ts";
import * as ThreadNotes from "./ThreadNotes.ts";

const database = NodeSqliteClient.layer({ filename: ":memory:" });
const layer = it.layer(Layer.merge(database, ThreadNotes.layer.pipe(Layer.provide(database))));

const threadId = ThreadId.make("thread-notes");
const otherThreadId = ThreadId.make("thread-notes-other");

layer("ThreadNotes", (it) => {
  it.effect("keeps notes per thread and removes them when cleared", () =>
    Effect.gen(function* () {
      // The table must survive a migration run, since it lives outside the migration list.
      yield* runMigrations();
      const notes = yield* ThreadNotes.ThreadNotes;

      assert.deepEqual(yield* notes.get(threadId), { markdown: "", updatedAt: null });

      const saved = yield* notes.set({ threadId, markdown: "# Plan\n- one" });
      assert.equal(saved.markdown, "# Plan\n- one");
      assert.isNotNull(saved.updatedAt);
      assert.deepEqual(yield* notes.get(threadId), saved);
      assert.deepEqual(yield* notes.get(otherThreadId), { markdown: "", updatedAt: null });

      yield* notes.set({ threadId, markdown: "# Plan\n- two" });
      assert.equal((yield* notes.get(threadId)).markdown, "# Plan\n- two");

      assert.deepEqual(yield* notes.set({ threadId, markdown: "  \n" }), {
        markdown: "",
        updatedAt: null,
      });
      assert.deepEqual(yield* notes.get(threadId), { markdown: "", updatedAt: null });
    }),
  );
});
