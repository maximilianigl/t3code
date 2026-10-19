import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createThreadNotesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** Not kept after the pad closes: a reopened pad must not start from a copy older than its last save. */
    notes: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:thread-notes",
      tag: WS_METHODS.threadNotesGet,
      idleTtlMs: 0,
    }),
    /** Saves in order per thread, so a slow earlier save cannot overwrite a later one. */
    setNotes: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:thread-notes:set",
      tag: WS_METHODS.threadNotesSet,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => `${environmentId}:${input.threadId}`,
      },
    }),
  };
}
