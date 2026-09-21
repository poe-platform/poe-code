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

import {
  createResolvedAgentConfig,
  cloneAgentPlugin,
  cloneMcpServerConfig,
  resolvePluginSetupOrder,
  toRuntimePlugins
} from "../dist/index.js";
import * as referenceConfig from "../../poe-agent/dist/runtime/config.js";
const configA: typeof referenceConfig.createResolvedAgentConfig = createResolvedAgentConfig;
const configB: typeof createResolvedAgentConfig = referenceConfig.createResolvedAgentConfig;
const pluginA: typeof referenceConfig.cloneAgentPlugin = cloneAgentPlugin;
const pluginB: typeof cloneAgentPlugin = referenceConfig.cloneAgentPlugin;
const mcpA: typeof referenceConfig.cloneMcpServerConfig = cloneMcpServerConfig;
const mcpB: typeof cloneMcpServerConfig = referenceConfig.cloneMcpServerConfig;
const orderA: typeof referenceConfig.resolvePluginSetupOrder = resolvePluginSetupOrder;
const orderB: typeof resolvePluginSetupOrder = referenceConfig.resolvePluginSetupOrder;
const runtimeA: typeof referenceConfig.toRuntimePlugins = toRuntimePlugins;
const runtimeB: typeof toRuntimePlugins = referenceConfig.toRuntimePlugins;
void configA;
void configB;
void pluginA;
void pluginB;
void mcpA;
void mcpB;
void orderA;
void orderB;
void runtimeA;
void runtimeB;

import { createFileAwarenessTracker, recordToolFileAwareness } from "../dist/index.js";
import * as referenceAwareness from "../../poe-agent/dist/runtime/file-awareness.js";
const awarenessA: typeof referenceAwareness.createFileAwarenessTracker = createFileAwarenessTracker;
const awarenessB: typeof createFileAwarenessTracker = referenceAwareness.createFileAwarenessTracker;
const recordA: typeof referenceAwareness.recordToolFileAwareness = recordToolFileAwareness;
const recordB: typeof recordToolFileAwareness = referenceAwareness.recordToolFileAwareness;
void awarenessA;
void awarenessB;
void recordA;
void recordB;

import * as ownHooks from "../dist/hooks.js";
import * as referenceHooks from "../../poe-agent/dist/runtime/hooks.js";
const hooksA: Omit<referenceHooks.HookRegistry, "copyFrom"> = new ownHooks.HookRegistry();
const hooksB: Omit<ownHooks.HookRegistry, "copyFrom"> = new referenceHooks.HookRegistry();
const createSessionA: typeof referenceHooks.createSessionStartHookContext =
  ownHooks.createSessionStartHookContext;
const createSessionB: typeof ownHooks.createSessionStartHookContext =
  referenceHooks.createSessionStartHookContext;
const hookDecisionA: typeof referenceHooks.applyHookDecision = ownHooks.applyHookDecision;
const hookDecisionB: typeof ownHooks.applyHookDecision = referenceHooks.applyHookDecision;
const hookInputA: typeof referenceHooks.applyInputDecision = ownHooks.applyInputDecision;
const hookInputB: typeof ownHooks.applyInputDecision = referenceHooks.applyInputDecision;
const hookCallA: typeof referenceHooks.applyToolCallDecision = ownHooks.applyToolCallDecision;
const hookCallB: typeof ownHooks.applyToolCallDecision = referenceHooks.applyToolCallDecision;
const hookResultA: typeof referenceHooks.applyToolResultDecision = ownHooks.applyToolResultDecision;
const hookResultB: typeof ownHooks.applyToolResultDecision = referenceHooks.applyToolResultDecision;
void hooksA;
void hooksB;
void createSessionA;
void createSessionB;
void hookDecisionA;
void hookDecisionB;
void hookInputA;
void hookInputB;
void hookCallA;
void hookCallB;
void hookResultA;
void hookResultB;

import * as referencePrompts from "../../poe-agent/dist/runtime/prompts.js";
const promptsA: Omit<referencePrompts.PromptRegistry, "copyFrom"> = new own.PromptRegistry();
const promptsB: Omit<own.PromptRegistry, "copyFrom"> = new referencePrompts.PromptRegistry();
void [promptsA, promptsB];
