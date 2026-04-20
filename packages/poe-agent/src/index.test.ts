import { describe, expect, it } from "vitest";
import {
  auditLogPlugin,
  builtinPluginRegistry,
  compactionPlugin,
  createTranscriptWriter,
  environmentPlugin,
  filesPlugin,
  gitContextPlugin,
  InvalidToolNameError,
  mapAcpEventToSessionUpdates,
  maxIterationsPlugin,
  mcpPlugin,
  memoryPlugin,
  openaiChatCompletionsPlugin,
  parsePluginConfigEntries,
  parsePluginConfigEntry,
  DuplicateProviderNameError,
  ProviderResolutionError,
  policyPlugin,
  resolvePluginsFromConfig,
  scratchpadPlugin,
  shellPlugin,
  skillsPlugin,
  spawnPlugin,
  systemPromptPlugin,
  webPlugin
} from "./index.js";
import auditLog from "./plugins/poe-agent-plugin-audit-log.js";
import compaction from "./plugins/poe-agent-plugin-compaction.js";
import environment from "./plugins/poe-agent-plugin-environment.js";
import files from "./plugins/poe-agent-plugin-files.js";
import gitContext from "./plugins/poe-agent-plugin-git-context.js";
import maxIterations from "./plugins/poe-agent-plugin-max-iterations.js";
import mcp from "./plugins/poe-agent-plugin-mcp.js";
import memory from "./plugins/poe-agent-plugin-memory.js";
import { openaiChatCompletionsPlugin as openaiChatCompletions } from "./plugins/poe-agent-plugin-openai-chat-completions.js";
import policy from "./plugins/poe-agent-plugin-policy.js";
import {
  DuplicateProviderNameError as duplicateProviderName,
  ProviderResolutionError as providerResolution
} from "./runtime/resolve-provider.js";
import scratchpad from "./plugins/poe-agent-plugin-scratchpad.js";
import shell from "./plugins/poe-agent-plugin-shell.js";
import skills from "./plugins/poe-agent-plugin-skills.js";
import spawn from "./plugins/poe-agent-plugin-spawn.js";
import systemPrompt from "./plugins/poe-agent-plugin-system-prompt.js";
import {
  createTranscriptWriter as createTranscriptWriterFromRuntime,
  mapAcpEventToSessionUpdates as mapAcpEventToSessionUpdatesFromRuntime
} from "./runtime/transcript.js";
import { InvalidToolNameError as invalidToolName } from "./runtime/tool-names.js";
import web from "./plugins/poe-agent-plugin-web.js";

describe("package root exports", () => {
  it("re-exports built-in plugins without deep imports", () => {
    expect(auditLogPlugin).toBe(auditLog);
    expect(compactionPlugin).toBe(compaction);
    expect(environmentPlugin).toBe(environment);
    expect(filesPlugin).toBe(files);
    expect(gitContextPlugin).toBe(gitContext);
    expect(maxIterationsPlugin).toBe(maxIterations);
    expect(mcpPlugin).toBe(mcp);
    expect(memoryPlugin).toBe(memory);
    expect(openaiChatCompletionsPlugin).toBe(openaiChatCompletions);
    expect(policyPlugin).toBe(policy);
    expect(scratchpadPlugin).toBe(scratchpad);
    expect(shellPlugin).toBe(shell);
    expect(skillsPlugin).toBe(skills);
    expect(spawnPlugin).toBe(spawn);
    expect(systemPromptPlugin).toBe(systemPrompt);
    expect(webPlugin).toBe(web);
  });

  it("re-exports plugin registry helpers without deep imports", () => {
    expect(builtinPluginRegistry.get("web")).toBeDefined();
    expect(parsePluginConfigEntry({ name: "web" })).toEqual({ name: "web" });
    expect(parsePluginConfigEntries([{ name: "web" }])).toEqual([{ name: "web" }]);
    expect(typeof resolvePluginsFromConfig).toBe("function");
  });

  it("re-exports provider/tool errors without deep imports", () => {
    expect(DuplicateProviderNameError).toBe(duplicateProviderName);
    expect(InvalidToolNameError).toBe(invalidToolName);
    expect(ProviderResolutionError).toBe(providerResolution);
  });

  it("re-exports transcript helpers without deep imports", () => {
    expect(createTranscriptWriter).toBe(createTranscriptWriterFromRuntime);
    expect(mapAcpEventToSessionUpdates).toBe(mapAcpEventToSessionUpdatesFromRuntime);
  });
});
