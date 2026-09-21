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

import type * as originalTools from "../../poe-agent/dist/runtime/tools.js";
import type * as originalErrors from "../../poe-agent/dist/runtime/errors.js";
// Private fields make the implementation classes nominal; compare their public surfaces.
type ToolKeys = Exclude<keyof originalTools.ToolRegistry, "copyFrom">;
type ToolSurface = Pick<originalTools.ToolRegistry, ToolKeys>;
const toolsA: ToolSurface = new own.ToolRegistry();
const toolsB: Pick<own.ToolRegistry, ToolKeys> = null as unknown as ToolSurface;
const normalizeA: typeof originalTools.normalizeTool = own.normalizeTool;
const normalizeB: typeof own.normalizeTool = null as unknown as typeof originalTools.normalizeTool;
const errorsA: typeof originalErrors = own;
const errorsB: Pick<typeof own, keyof typeof originalErrors> =
  null as unknown as typeof originalErrors;
void [toolsA, toolsB, normalizeA, normalizeB, errorsA, errorsB];
