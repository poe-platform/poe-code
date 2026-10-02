import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, test } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("runtime-core imports share the canonical public filesystem", async () => {
  const recipe = resolveBrowserShellBuild(root);
  const result = await build({
    ...recipe, entryPoints: undefined,
    stdin: { contents: 'export { FsError } from "@poe-code/safe-fs/runtime-core";', resolveDir: root, sourcefile: "runtime-core-probe.ts" },
  });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect([...new Set(imports.filter(item => item.external).map(item => item.path))]).toEqual(["poe-code/safe-fs/core"]);
});

const families = {
  metadata: "Metadata", archive: "Archive", "table-text": "TableText",
  "stream-inspection": "StreamInspection", "stream-format": "StreamFormat", split: "Split",
  "time-env": "TimeEnv", tree: "Tree", file: "File", column: "Column",
  "html-to-markdown": "HtmlToMarkdown", du: "Du", expr: "Expr", "apply-patch": "ApplyPatch",
  chmod: "Chmod", stat: "Stat", mktemp: "Mktemp",
};

test("each command subpath resolves and executes in workerd without Node compatibility", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  const recipe = resolveBrowserShellBuild(root);
  const entryPoints: Record<string, string> = {};
  for (const name of Object.keys(families)) {
    const target = `./dist/commands/${name}/index.browser.js`;
    expect(pkg.exports[`./commands/${name}`].workerd).toBe(target);
    expect(pkg.exports[`./commands/${name}`].browser).toBe(target);
    const entry = `commands/${name}/index.browser`;
    entryPoints[entry] = recipe.entryPoints[entry];
  }
  const core = path.join(root, "packages/safe-fs/src/core.ts");
  entryPoints.filesystem = core;
  const result = await build({ ...recipe, entryPoints, sourcemap: false, external: [], alias: {
    ...recipe.alias, "@poe-code/safe-fs/runtime-core": core, "@poe-code/safe-fs/core": core, "@poe-code/safe-fs": core,
    "poe-code/safe-fs/core": core, "poe-code/safe-fs": core,
    "@poe-code/xml-ast": path.join(root, "packages/xml-ast/src/index.ts"),
  } });
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports).filter(item => item.external)).toEqual([]);
  const imports = Object.keys(families).map((name, index) => `import * as family${index} from "./commands/${name}/index.browser.js";`).join("\n");
  const factories = Object.values(families).map((name, index) => `family${index}.create${name}Commands`).join(",");
  const script = `${imports}
    import { createMemoryFileSystem } from "./filesystem.js";
    export default { async fetch() {
      const results = [];
      for (const factory of [${factories}]) {
        const command = factory()[0];
        const fs = createMemoryFileSystem();
        await fs.writeFile("/input", new TextEncoder().encode("portable\\n"));
        const argumentsByCommand = {
          chmod: ["600", "/input"], stat: ["/input"], mktemp: ["/probe.XXXXXX"],
          tar: ["-cf", "-", "input"], paste: ["/input"], tac: ["/input"],
          seq: ["1", "3"], split: ["/input", "/part"], date: ["+%Y"],
          tree: ["/"], file: ["/input"], column: ["/input"],
          "html-to-markdown": [], du: ["--apparent-size", "/input"], expr: ["2", "+", "3"],
        };
        const args = command.name === "apply_patch"
          ? ["*** Begin Patch\\n*** Add File: /probe\\n+portable\\n*** End Patch\\n"]
          : argumentsByCommand[command.name];
        if (!args) throw new Error("Missing portable invocation: " + command.name);
        let stdout = "", stderr = "";
        const result = await command.execute({ command: command.name, args, cwd: "/", env: {},
          signal: new AbortController().signal, fs, stdin: (async function* () { yield new TextEncoder().encode("<p>portable</p>"); })(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        if (result.exitCode !== 0) throw new Error(command.name + ": " + stderr);
        let fileEffect;
        if (command.name === "chmod") fileEffect = (await fs.stat("/input")).mode & 0o777;
        if (command.name === "split") fileEffect = new TextDecoder().decode(await fs.readFile("/partaa"));
        if (command.name === "mktemp") fileEffect = (await fs.stat(stdout.trim())).type === "file";
        results.push({ name: command.name, exitCode: result.exitCode, stdout, stderr, fileEffect });
      }
      return Response.json(results);
    } };`;
  const runtime = new Miniflare({ modulesRoot: recipe.outdir, compatibilityDate: "2026-07-01", cf: false,
    modules: [
      { type: "ESModule", path: path.join(recipe.outdir, "probe.mjs"), contents: script },
      ...result.outputFiles!.map(file => ({ type: "ESModule" as const, path: file.path, contents: file.text })),
    ],
  });
  try {
    for (let invocation = 0; invocation < 2; invocation++) {
      const response = await runtime.dispatchFetch("http://localhost/");
      expect(response.status, await response.clone().text()).toBe(200);
      const results = await response.json() as { name: string; exitCode: number; stdout: string; stderr: string; fileEffect?: unknown }[];
      expect(results.length).toBeGreaterThanOrEqual(Object.keys(families).length);
      for (const result of results) {
        expect(result.exitCode, `${result.name}: ${result.stderr}`).toBe(0);
        if (result.name === "chmod") expect(result.fileEffect).toBe(0o600);
        else if (result.name === "split") expect(result.fileEffect).toBe("portable\n");
        else expect(result.stdout.length, result.name).toBeGreaterThan(0);
        if (result.name === "expr") expect(result.stdout).toBe("5\n");
        if (result.name === "mktemp") expect(result.fileEffect).toBe(true);
      }
    }
  } finally { await runtime.dispose(); }
}, 30_000);
