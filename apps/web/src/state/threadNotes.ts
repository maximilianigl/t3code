import { createThreadNotesEnvironmentAtoms } from "@t3tools/client-runtime/state/thread-notes";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadNotesEnvironment = createThreadNotesEnvironmentAtoms(connectionAtomRuntime);
