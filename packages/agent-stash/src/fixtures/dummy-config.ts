import { serializeManifest } from "../manifest.js";
import type { AgentStashManifest, GistRecord } from "../types.js";

export const dummyCwd = "/repo";
export const dummyHome = "/home/user";
export const fixedDate = new Date("2026-01-02T03:04:05.000Z");

export function createDummyAgentConfigFixture(): Record<string, string> {
  return {
    "/repo/.claude/skills/code-review/SKILL.md": "# Code Review\n",
    "/repo/.claude/skills/commit-helper/SKILL.md": "# Commit Helper\n",
    "/repo/.claude/skills/project-only/SKILL.md": "# Project Only\n",
    "/repo/.claude/settings.json": JSON.stringify(
      {
        permissions: { allow: ["Bash(npm test)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
        }
      },
      null,
      2
    ),
    "/repo/.codex/skills/codex-project/SKILL.md": "# Codex Project\n",
    "/repo/.codex/hooks.json": JSON.stringify(
      {
        hooks: {
          PreToolUse: [{ matcher: "Shell", hooks: [{ type: "command", command: "npm lint" }] }]
        }
      },
      null,
      2
    ),
    "/repo/.agent-stashignore": "*.local.md\n",
    "/home/user/.claude/skills/code-review/SKILL.md": "# Global Review\n",
    "/home/user/.claude/skills/global-only/SKILL.md": "# Global Only\n",
    "/home/user/.claude/settings.json": JSON.stringify(
      {
        env: { KEEP: "1" },
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "global stop" }] }]
        }
      },
      null,
      2
    ),
    "/home/user/.codex/skills/codex-global/SKILL.md": "# Codex Global\n",
    "/home/user/.codex/hooks.json": JSON.stringify(
      {
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "codex stop" }] }]
        }
      },
      null,
      2
    ),
    "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-default" } } }, null, 2),
    "/home/user/.agent-stash/ignore": "secrets/**\n"
  };
}

export function createGistRecordFromManifest(manifest: AgentStashManifest, files: Record<string, string>): GistRecord {
  return {
    id: "gist-default",
    htmlUrl: "https://gist.github.com/gist-default",
    files: {
      "agent-stash.json": { filename: "agent-stash.json", content: serializeManifest(manifest) },
      ...Object.fromEntries(
        Object.entries(files).map(([filename, content]) => [filename, { filename, content }])
      )
    }
  };
}
