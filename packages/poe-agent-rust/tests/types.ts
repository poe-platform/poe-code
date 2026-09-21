import * as own from "../dist/index.js";
import type * as original from "@poe-code/poe-agent";
type Supported = Pick<
  typeof original,
  | "collectProviders"
  | "resolveProvider"
  | "DuplicateProviderNameError"
  | "ProviderResolutionError"
  | "InvalidToolNameError"
  | "createAgentSessionStore"
>;
const a: Supported = own;
const b: Pick<typeof own, keyof Supported> = null as unknown as Supported;
void [a, b];

import type * as originalLog from "../../poe-agent/dist/runtime/session/session-store.js";
type LogSupported = Pick<
  typeof originalLog,
  "createMemorySessionStore" | "createJsonlSessionStore"
>;
const logA: LogSupported = own;
const logB: Pick<typeof own, keyof LogSupported> = null as unknown as LogSupported;
void [logA, logB];
