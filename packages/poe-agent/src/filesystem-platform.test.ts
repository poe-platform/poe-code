import { expect, it, vi } from "vitest";
vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...actual, default: actual.win32 };
});
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { agent } from "./agent.js";
import filesPlugin from "./plugins/poe-agent-plugin-files.js";
import memoryPlugin from "./plugins/poe-agent-plugin-memory.js";
import skillsPlugin from "./plugins/poe-agent-plugin-skills.js";
import { installSkill } from "../../../src/skills.js";
import { createAgentSessionStore } from "./session-store.js";
import { toAcpModelResponse } from "./testing/model-response.js";

it("keeps custom namespaces POSIX when the platform path implementation is Windows", async () => {
  const fs = createMemoryFileSystem();
  const bytes = (s: string) => new TextEncoder().encode(s);
  await fs.mkdir("/workspace/skills/demo", { recursive: true });
  await fs.writeFile("/workspace/AGENTS.md", bytes("@./import.md"));
  await fs.writeFile("/workspace/import.md", bytes("virtual imported memory"));
  await fs.writeFile("/workspace/skills/demo/SKILL.md", bytes("# Demo"));
  await fs.writeFile("/workspace/sample.txt", bytes("sample"));
  await installSkill("claude", { name: "installed", content: "# Installed" }, { fs, cwd: "/workspace", homeDir: "/home" });
  expect(new TextDecoder().decode(await fs.readFile("/workspace/.claude/skills/installed/SKILL.md"))).toContain("Installed");
  const store = createAgentSessionStore({ fs, homeDir: "/home" });
  await store.save({ version: 1, threadId: "virtual", model: "synthetic", cwd: "/workspace", createdAt: "now", updatedAt: "now", messages: [] });
  expect(await store.load("virtual")).toMatchObject({ threadId: "virtual" });
  let system = "";
  await agent({ fs, cwd: "/workspace", homeDir: "/home" })
    .use(memoryPlugin())
    .use(filesPlugin())
    .use(skillsPlugin({ directories: ["skills"] }))
    .use({ name: "inspect", async setup(api) {
      const ctx = { runtime: api.runtime, signal: api.signal, fork: vi.fn(), spawn: vi.fn() };
      expect((await api.getTool("read_file")!.invoke({ path: "sample.txt" }, ctx).next()).value).toBe("sample");
      await api.getTool("edit_file")!.invoke({ command: "str_replace", path: "sample.txt", old_str: "sample", new_str: "updated" }, ctx).next();
    }, prompt(ctx) { system = ctx.system ?? ""; return ctx; } })
    .run("hello", { logPath: "/workspace/logs/transcript.jsonl", acpModel: { complete: async () => toAcpModelResponse({ content: "done" }) } });
  expect((await fs.stat("/workspace/logs/transcript.jsonl")).type).toBe("file");
  expect(system).toContain("virtual imported memory");
  expect(system).toContain("/workspace/skills/demo/SKILL.md");
  expect(new TextDecoder().decode(await fs.readFile("/workspace/sample.txt"))).toBe("updated");
});
