import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

it("runs a harness pair and cleans its journal on an injected portable filesystem", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "harness", logLevel: "silent" });
  const runtime = new Function(`${bundle.outputFiles[0].text}; return harness;`)();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/example", { recursive: true });
  await fs.writeFile("/repo/example/example.md", new TextEncoder().encode("---\nkind: portable\n---\n"));
  await fs.writeFile("/repo/example/example.ajs", new TextEncoder().encode(
    'import { now } from "time"; export default async function(frontmatter) { return { kind: frontmatter.kind, time: now() }; }'));
  expect(await runtime.discoverHarnesses("/repo", fs)).toHaveLength(1);
  const result = await runtime.runHarnessPair("/repo/example/example.md", {
    fs, homeDir: "/home/user", modulesFor: () => ({}), snapshotPath: "/repo/state.json", clock: { now: () => 42 }
  });
  expect(result.ok).toBe(true);
  expect(result.returnValue).toEqual({ kind: "portable", time: 42 });
  await expect(fs.stat("/repo/state.json.host-calls.json")).rejects.toThrow();
  await runtime.assertReplayEquivalent("/repo/example/example.md", () => ({}), { fs, temporaryDirectory: "/scratch" });
  expect(await fs.readdir("/scratch")).toEqual([]);
  await fs.mkdir("/templates/demo", { recursive: true });
  await fs.writeFile("/templates/demo/demo.ajs", new TextEncoder().encode(
    'import { S } from "schema"; export const schema = S.Object({ kind: S.String() });'));
  await runtime.runHarnessCodegen({ fs, repoRoot: "/repo", templateDirectory: "/templates" });
  const schema = JSON.parse(new TextDecoder().decode(await fs.readFile("/repo/docs/schemas/harnesses/demo.schema.json")));
  expect(schema.properties.kind.type).toBe("string");
  expect(runtime.listBuiltinTemplates("/templates")[0].mdPath).toBe("/templates/ralph-demo/ralph-demo.md");
});
