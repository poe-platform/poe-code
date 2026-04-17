import { describe, expect, it } from "vitest";
import {
  auditLogPlugin,
  compactionPlugin,
  environmentPlugin,
  filesPlugin,
  gitContextPlugin,
  maxIterationsPlugin,
  mcpPlugin,
  memoryPlugin,
  policyPlugin,
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
import policy from "./plugins/poe-agent-plugin-policy.js";
import scratchpad from "./plugins/poe-agent-plugin-scratchpad.js";
import shell from "./plugins/poe-agent-plugin-shell.js";
import skills from "./plugins/poe-agent-plugin-skills.js";
import spawn from "./plugins/poe-agent-plugin-spawn.js";
import systemPrompt from "./plugins/poe-agent-plugin-system-prompt.js";
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
    expect(policyPlugin).toBe(policy);
    expect(scratchpadPlugin).toBe(scratchpad);
    expect(shellPlugin).toBe(shell);
    expect(skillsPlugin).toBe(skills);
    expect(spawnPlugin).toBe(spawn);
    expect(systemPromptPlugin).toBe(systemPrompt);
    expect(webPlugin).toBe(web);
  });
});
