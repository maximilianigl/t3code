import { CommandId, type RunId, type ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  buildObserverPrompt,
  DEFAULT_OBSERVER_PROMPT,
  observerLearnKey,
  parseObserverAnswer,
} from "@t3tools/shared/observerPrompt";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";

// The mod keeps the last 50 suggestions it showed and the last 50 the user already knew.
const LIST_LIMIT = 50;

/**
 * The "You should know" observer: when a run completes, asks the thread's live
 * provider session (as a side question, so it reuses the prompt cache and stays
 * out of the conversation) whether there is something the user should know.
 */
export class ObserverReactor extends Context.Service<
  ObserverReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ObserverReactor") {}

/** @public */
export const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const check = Effect.fn("ObserverReactor.check")(function* (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) {
    const settings = yield* serverSettings.getSettings;
    if (!settings.observerEnabled) return;
    const projection = yield* projections.getThreadRecords(input.threadId, [
      "runs",
      "providerThreads",
    ]);
    if (projection.thread.lineage.relationshipToParent === "subagent") return;
    const run = projection.runs.find((candidate) => candidate.id === input.runId);
    if (run === undefined || run.observerNote !== undefined) return;
    // The side question forks the session's latest request, which belongs to a newer run now.
    if (projection.runs.some((candidate) => candidate.ordinal > run.ordinal)) return;
    const providerThread = projection.providerThreads.find(
      (candidate) => candidate.id === run.providerThreadId,
    );
    if (providerThread?.providerSessionId == null) return;
    // Never start a provider for this: only a session that is still running is asked.
    const runtime = Option.getOrNull(yield* providerSessions.get(providerThread.providerSessionId));
    if (runtime?.askSideQuestion === undefined) return;

    const recent = yield* projections.getRecentObserverNotes(LIST_LIMIT * 4);
    const seen = recent.slice(0, LIST_LIMIT).map((note) => note.learn);
    const known = recent
      .filter((note) => note.feedback === "known")
      .slice(0, LIST_LIMIT)
      .map((note) => note.learn);
    const answer = yield* runtime.askSideQuestion({
      providerThread,
      question: buildObserverPrompt(settings.observerPrompt || DEFAULT_OBSERVER_PROMPT, {
        seen,
        known,
      }),
    });
    const parsed = parseObserverAnswer(answer);
    if (parsed.kind === "invalid") {
      yield* Effect.logWarning("observer answer did not follow the format", {
        threadId: input.threadId,
        runId: input.runId,
      });
      return;
    }
    if (parsed.kind === "none") return;
    const key = observerLearnKey(parsed.learn);
    if ([...seen, ...known].some((learn) => observerLearnKey(learn) === key)) return;
    yield* engine.dispatch({
      type: "run.observer-note.record",
      commandId: CommandId.make(`server:observer-note:${input.runId}`),
      threadId: input.threadId,
      runId: input.runId,
      observerNote: {
        learn: parsed.learn,
        tag: parsed.tag,
        explanation: parsed.explanation,
        feedback: null,
      },
    });
  });

  const worker = yield* makeDrainableWorker((input: { threadId: ThreadId; runId: RunId }) =>
    check(input).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("observer check skipped", { ...input, cause }),
      ),
    ),
  );

  // A run can be reported completed more than once; each check costs a model call.
  const checkedRunIds = new Set<RunId>();

  const start: ObserverReactor["Service"]["start"] = Effect.fn("ObserverReactor.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) => {
          if (
            event.type !== "run.updated" ||
            event.payload.status !== "completed" ||
            checkedRunIds.has(event.payload.id)
          ) {
            return Effect.void;
          }
          checkedRunIds.add(event.payload.id);
          return worker.enqueue({ threadId: event.threadId, runId: event.payload.id });
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("observer event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return { start, drain: worker.drain } satisfies ObserverReactor["Service"];
});

export const layer = Layer.effect(ObserverReactor, make);
