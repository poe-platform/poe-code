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

import * as referenceContext from "../../poe-agent/dist/runtime/run-context.js";
type ContextMethods =
  | "logger"
  | "messages"
  | "session"
  | "mcpServers"
  | "activeSkills"
  | "fileAwareness"
  | "abortController"
  | "childRuns"
  | "registerDisposeHook"
  | "trackChildRun"
  | "getChildRunCount"
  | "dispose";
const contextA: Pick<referenceContext.RunContext, ContextMethods> = new own.RunContext();
const contextB: Pick<own.RunContext, ContextMethods> = new referenceContext.RunContext();
const contextOptionsA: referenceContext.CreateRunContextOptions = {} as own.CreateRunContextOptions;
const contextOptionsB: own.CreateRunContextOptions = {} as referenceContext.CreateRunContextOptions;
void [contextA, contextB, contextOptionsA, contextOptionsB];

import * as referenceResults from "../../poe-agent/dist/runtime/tool-results.js";
const resultsA: typeof referenceResults = own;
const resultsB: Pick<typeof own, keyof typeof referenceResults> = referenceResults;
void [resultsA, resultsB];

import * as referenceTree from "../../poe-agent/dist/runtime/session/session-tree.js";
const treeA: typeof referenceTree = own;
const treeB: Pick<typeof own, keyof typeof referenceTree> = referenceTree;
void [treeA, treeB];

import * as referenceTranscript from "../../poe-agent/dist/runtime/transcript.js";
const transcriptA: typeof referenceTranscript = own;
const transcriptB: Pick<typeof own, keyof typeof referenceTranscript> = referenceTranscript;
const transcriptOptionsA: referenceTranscript.CreateTranscriptWriterOptions =
  {} as own.CreateTranscriptWriterOptions;
const transcriptOptionsB: own.CreateTranscriptWriterOptions =
  {} as referenceTranscript.CreateTranscriptWriterOptions;
void [transcriptA, transcriptB, transcriptOptionsA, transcriptOptionsB];

import { PluginApiImpl as ReferencePluginApiImpl } from "../../poe-agent/dist/runtime/plugin-api-impl.js";
import { runPluginSetup as referencePluginSetup } from "../../poe-agent/dist/runtime/plugin-setup.js";
import type { PluginApi as ReferencePluginApi } from "../../poe-agent/dist/runtime/plugin-types.js";
const pluginApiA: ReferencePluginApi = new own.PluginApiImpl(new own.RunContext());
const pluginApiB: own.PluginApi = new ReferencePluginApiImpl(new referenceContext.RunContext());
const pluginEntriesA: Parameters<typeof referencePluginSetup>[0] = [] as Parameters<
  typeof own.runPluginSetup
>[0];
const pluginEntriesB: Parameters<typeof own.runPluginSetup>[0] = [] as Parameters<
  typeof referencePluginSetup
>[0];
const flushA: ReferencePluginApiImpl["flushSetup"] = new own.PluginApiImpl(new own.RunContext())
  .flushSetup;
const flushB: own.PluginApiImpl["flushSetup"] = new ReferencePluginApiImpl(
  new referenceContext.RunContext()
).flushSetup;
void [pluginApiA, pluginApiB, pluginEntriesA, pluginEntriesB, flushA, flushB];

import { runAcpCore as referenceExecution } from "../../poe-agent/dist/runtime/acp-core.js";
const executionModelA: Parameters<typeof referenceExecution>[0]["model"] = {} as own.AcpModel;
const executionModelB: own.AcpModel = {} as Parameters<typeof referenceExecution>[0]["model"];
const executionOptionsA: Omit<Parameters<typeof referenceExecution>[0], "runContext"> = {} as Omit<
  own.RunAcpCoreOptions,
  "runContext"
>;
const executionOptionsB: Omit<own.RunAcpCoreOptions, "runContext"> = {} as Omit<
  Parameters<typeof referenceExecution>[0],
  "runContext"
>;
void [executionModelA, executionModelB, executionOptionsA, executionOptionsB];

import { AgentHost as ReferenceAgentHost } from "../../poe-agent/dist/runtime/agent-host.js";
const hostA: ReferenceAgentHost["handle"] = new own.AgentHost({} as own.AgentHostOptions).handle;
const hostB: own.AgentHost["fork"] = new ReferenceAgentHost(
  {} as ConstructorParameters<typeof ReferenceAgentHost>[0]
).fork;
const hostSpawnA: import("../../poe-agent/dist/runtime/agent-host.js").AgentHostSpawnClient =
  {} as own.AgentHostSpawnClient;
const hostSpawnB: own.AgentHostSpawnClient =
  {} as import("../../poe-agent/dist/runtime/agent-host.js").AgentHostSpawnClient;
void [hostA, hostB, hostSpawnA, hostSpawnB];

import referenceSkillsPlugin from "../../poe-agent/dist/plugins/poe-agent-plugin-skills.js";
import referenceScratchpadPlugin from "../../poe-agent/dist/plugins/poe-agent-plugin-scratchpad.js";
import referenceMcpPlugin from "../../poe-agent/dist/plugins/poe-agent-plugin-mcp.js";
import referencePolicyPlugin from "../../poe-agent/dist/plugins/poe-agent-plugin-policy.js";
const builtinSkillsA: typeof referenceSkillsPlugin = own.skillsPlugin;
const builtinSkillsB: typeof own.skillsPlugin = referenceSkillsPlugin;
const builtinScratchA: typeof referenceScratchpadPlugin = own.scratchpadPlugin;
const builtinMcpA: typeof referenceMcpPlugin = own.mcpPlugin;
const builtinPolicyA: typeof referencePolicyPlugin = own.policyPlugin;
const builtinPolicyB: typeof own.policyPlugin = referencePolicyPlugin;
void [builtinSkillsA, builtinSkillsB, builtinScratchA, builtinMcpA, builtinPolicyA, builtinPolicyB];

import referenceMemoryPlugin from "../../poe-agent/dist/plugins/poe-agent-plugin-memory.js";
import referenceCompactionPlugin from "../../poe-agent/dist/plugins/poe-agent-plugin-compaction.js";
import referenceAuditPlugin from "../../poe-agent/dist/plugins/poe-agent-plugin-audit-log.js";
const contextMemoryA: typeof referenceMemoryPlugin = own.memoryPlugin;
const contextMemoryB: typeof own.memoryPlugin = referenceMemoryPlugin;
const contextCompactionA: typeof referenceCompactionPlugin = own.compactionPlugin;
const contextCompactionB: typeof own.compactionPlugin = referenceCompactionPlugin;
const contextAuditA: typeof referenceAuditPlugin = own.auditLogPlugin;
void [contextMemoryA, contextMemoryB, contextCompactionA, contextCompactionB, contextAuditA];

import referenceFilesPlugin from "../../poe-agent/dist/plugins/poe-agent-plugin-files.js";
const filesA: typeof referenceFilesPlugin = own.filesPlugin;
const filesB: typeof own.filesPlugin = referenceFilesPlugin;
void [filesA, filesB];
