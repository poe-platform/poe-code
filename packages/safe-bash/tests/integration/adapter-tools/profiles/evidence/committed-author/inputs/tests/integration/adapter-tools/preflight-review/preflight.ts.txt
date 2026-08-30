import assert from "node:assert/strict";
import type { CommandRegistry } from "../../../../src/index.js";

export const requiredWorkflowCommands = {
  standard: ["cat", "cp", "find", "mkdir", "mv", "printf", "pwd", "rm", "rmdir", "sort", "tee", "test", "touch", "xargs"],
  text: ["sed", "awk"],
  structured: ["jq"],
  search: ["rg"],
  bytes: ["sha256sum", "gzip"],
  diffPatch: ["diff", "patch"],
} as const;

export function assertWorkflowCommands(registry: Pick<CommandRegistry, "get">): void {
  for (const [family, names] of Object.entries(requiredWorkflowCommands)) {
    for (const name of names) {
      const command = registry.get(name);
      assert.ok(command, `adapter-tools preflight: missing required ${family} command: ${name}`);
      assert.equal(typeof command.execute, "function", `adapter-tools preflight: ${family} command is not executable: ${name}`);
    }
  }
}
