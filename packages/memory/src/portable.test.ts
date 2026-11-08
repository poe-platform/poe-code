import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

it("isolates memory handles and reconciles writes in a Worker without Node compatibility", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "memory", logLevel: "silent" });
  const runtime = new Function(`${bundle.outputFiles[0].text}; return memory;`)();
  const fs = new MemoryFileSystem();
  const otherFs = new MemoryFileSystem();
  const root = "/repo/.poe-code/memory";
  const prompts: string[] = [];
  const memory = runtime.openMemory({ root, fs, countTokens: (text: string) => text.length,
    spawn: async (_agent: string, options: { prompt: string }) => {
      prompts.push(options.prompt);
      return { stdout: JSON.stringify({ answer: "Café", citations: [], tokensUsed: 1 }), stderr: "", exitCode: 0 };
    } });
  const other = runtime.openMemory({ root, fs: otherFs });
  await memory.writePage("pages/demo.md", "Café memory", { reason: "portable", frontmatter: { name: "Demo" } });
  expect((await memory.readPage("pages/demo.md")).body).toContain("Café memory");
  expect(await other.listPages()).toEqual([]);
  expect((await memory.searchMemory("Café"))[0].relPath).toBe("pages/demo.md");
  expect((await memory.statusOf()).pageCount).toBe(1);
  const before = await runtime.snapshot(root, { fs });
  expect(before.pages["pages/demo.md"]).toHaveLength(64);
  await memory.appendToPage("pages/demo.md", "More context", { reason: "append" });
  expect((await memory.readPage("pages/demo.md")).body).toContain("More context");
  const answer = await memory.query({ question: "What is remembered?", budget: 10000, agent: "codex" });
  expect(answer.answer).toBe("Café");
  expect(prompts[0]).toContain("More context");
  await fs.writeFile("/repo/source.md", new TextEncoder().encode("Source café"));
  await memory.ingest({ source: { kind: "file", absPath: "/repo/source.md" }, agent: "codex" });
  const cached = await memory.ingest({ source: { kind: "file", absPath: "/repo/source.md" }, agent: "codex" });
  expect(cached.cacheHit).toBe(true);
  expect((await runtime.cacheStatus(root, { fs })).entries).toBe(1);
  expect((await runtime.cacheStatus(root, { fs: otherFs })).entries).toBe(0);
  await runtime.installMemory({ agent: "codex", skillContent: "# Portable memory", fs,
    cwd: "/repo", homeDir: "/home/user", platform: "linux", skillOnly: true });
  expect(new TextDecoder().decode(await fs.readFile("/repo/.codex/skills/poe-code-memory/SKILL.md"))).toBe("# Portable memory");
  await memory.clearMemory();
  expect(await memory.listPages()).toEqual([]);
});
