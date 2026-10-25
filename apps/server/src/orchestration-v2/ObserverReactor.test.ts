import {
  EventId,
  MessageId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ObserverNote,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts/settings";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as ObserverReactor from "./ObserverReactor.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";

const AT = DateTime.makeUnsafe("2026-10-25T12:00:00.000Z");
const PROVIDER_THREAD_ID = ProviderThreadId.make("provider-thread");
const PROVIDER_SESSION_ID = ProviderSessionId.make("provider-session");

const NOTE_ANSWER = [
  "learn: The main agent skipped the migration, so the new column is not in the database yet.",
  "tag: Heads up",
  "explain:",
  "**The new column is not created yet**",
  "Run the migration before deploying.",
].join("\n");

function makeRun(threadId: ThreadId, ordinal: number): OrchestrationV2Run {
  return {
    id: RunId.make(`run:${threadId}:${ordinal}`),
    threadId,
    ordinal,
    providerInstanceId: ProviderInstanceId.make("claude"),
    modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" },
    providerThreadId: PROVIDER_THREAD_ID,
    userMessageId: MessageId.make(`message:${threadId}:${ordinal}`),
    rootNodeId: null,
    activeAttemptId: null,
    status: "completed",
    requestedAt: AT,
    startedAt: AT,
    completedAt: AT,
    checkpointId: null,
    contextHandoffId: null,
  };
}

function runCompleted(run: OrchestrationV2Run): OrchestrationV2DomainEvent {
  return {
    type: "run.updated",
    id: EventId.make(`event:${run.id}`),
    threadId: run.threadId,
    runId: run.id,
    occurredAt: AT,
    payload: run,
  };
}

const makeHarness = Effect.fn("makeObserverHarness")(function* (options: {
  readonly answers: Record<string, string>;
  readonly enabled?: boolean;
  readonly recentNotes?: ReadonlyArray<OrchestrationV2ObserverNote>;
}) {
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const questions = yield* Queue.unbounded<{
    readonly threadId: string;
    readonly prompt: string;
  }>();
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const settingsReads = yield* Queue.unbounded<void>();
  // Which thread the live session is answering for; the fake session reads it per question.
  const askingThread = yield* Ref.make("");

  const runtime = {
    askSideQuestion: ({ question }: { readonly question: string }) =>
      Effect.gen(function* () {
        const threadId = yield* Ref.get(askingThread);
        yield* Queue.offer(questions, { threadId, prompt: question });
        return options.answers[threadId] ?? "learn: none";
      }),
  };

  const layer = ObserverReactor.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          dispatch: (command) =>
            Ref.update(commands, (recorded) => [...recorded, command]).pipe(
              Effect.as({ sequence: 1, storedEvents: [] }),
            ),
          streamDomainEvents: Stream.fromQueue(domainEvents),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadRecords: (threadId) =>
            Ref.set(askingThread, threadId).pipe(
              Effect.as({
                thread: {
                  id: threadId,
                  lineage: {
                    parentThreadId: null,
                    relationshipToParent: null,
                    rootThreadId: threadId,
                  },
                },
                runs: [makeRun(threadId, 1)],
                providerThreads: [
                  { id: PROVIDER_THREAD_ID, providerSessionId: PROVIDER_SESSION_ID },
                ],
              } as never),
            ),
          getRecentObserverNotes: () => Effect.succeed(options.recentNotes ?? []),
        }),
        Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
          get: () => Effect.succeed(Option.some(runtime as never)),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Queue.offer(settingsReads, undefined).pipe(
            Effect.as({ ...DEFAULT_SERVER_SETTINGS, observerEnabled: options.enabled ?? true }),
          ),
        }),
      ),
    ),
  );
  return { domainEvents, questions, commands, settingsReads, layer };
});

describe("ObserverReactor", () => {
  it.effect("records the note the session flags, with earlier notes in the prompt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeHarness({
          answers: { one: NOTE_ANSWER },
          recentNotes: [
            {
              learn: "Earlier note.",
              tag: "you_should_know",
              explanation: "",
              feedback: "known",
            },
          ],
        });
        yield* Effect.gen(function* () {
          const reactor = yield* ObserverReactor.ObserverReactor;
          yield* reactor.start();
          const run = makeRun(ThreadId.make("one"), 1);
          // The same completion reported twice still asks once.
          yield* Queue.offer(fixture.domainEvents, runCompleted(run));
          yield* Queue.offer(fixture.domainEvents, runCompleted(run));
          const asked = yield* Queue.take(fixture.questions);
          yield* reactor.drain;

          assert.include(asked.prompt, "- Earlier note.");
          assert.notInclude(asked.prompt, "{{seen}}");
          assert.deepStrictEqual(yield* Ref.get(fixture.commands), [
            {
              type: "run.observer-note.record",
              commandId: `server:observer-note:${run.id}`,
              threadId: run.threadId,
              runId: run.id,
              observerNote: {
                learn:
                  "The main agent skipped the migration, so the new column is not in the database yet.",
                tag: "heads_up",
                explanation:
                  "**The new column is not created yet**\nRun the migration before deploying.",
                feedback: null,
              },
            },
          ] as never);
          assert.strictEqual(yield* Queue.size(fixture.questions), 0);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect("records nothing for learn: none or a note the user already knows", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeHarness({
          answers: { quiet: "learn: none", repeat: "learn: Earlier note\ntag: Heads up" },
          recentNotes: [
            { learn: "Earlier note.", tag: "heads_up", explanation: "", feedback: "known" },
          ],
        });
        yield* Effect.gen(function* () {
          const reactor = yield* ObserverReactor.ObserverReactor;
          yield* reactor.start();
          yield* Queue.offer(
            fixture.domainEvents,
            runCompleted(makeRun(ThreadId.make("quiet"), 1)),
          );
          yield* Queue.offer(
            fixture.domainEvents,
            runCompleted(makeRun(ThreadId.make("repeat"), 1)),
          );
          yield* Queue.take(fixture.questions);
          yield* Queue.take(fixture.questions);
          yield* reactor.drain;

          assert.deepStrictEqual(yield* Ref.get(fixture.commands), []);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect("asks nothing while the setting is off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeHarness({ answers: {}, enabled: false });
        yield* Effect.gen(function* () {
          const reactor = yield* ObserverReactor.ObserverReactor;
          yield* reactor.start();
          yield* Queue.offer(fixture.domainEvents, runCompleted(makeRun(ThreadId.make("one"), 1)));
          yield* Queue.take(fixture.settingsReads);
          yield* reactor.drain;

          assert.strictEqual(yield* Queue.size(fixture.questions), 0);
          assert.deepStrictEqual(yield* Ref.get(fixture.commands), []);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );
});
