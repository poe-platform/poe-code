import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, "packages/safe-bash/package.json"), "utf8"));
const subpaths = ["search", ...[
  "metadata", "archive", "table-text", "stream-inspection", "stream-format", "split",
  "time-env", "tree", "file", "grep-aliases", "column", "html-to-markdown", "du", "expr", "apply-patch",
].map(name => `commands/${name}`)];

it.each(subpaths)("publishes a portable bundle for %s", route => {
  const entry = manifest.exports[`./${route}`];
  const target = entry.import.slice(0, -3) + ".browser.js";
  expect(entry.workerd).toBe(target);
  expect(entry.browser).toBe(target);
  expect(entry.types).toBe(entry.import.slice(0, -3) + ".d.ts");
  const recipe = resolveBrowserShellBuild(root);
  expect(recipe.entryPoints[target.slice("./dist/".length, -3)])
    .toBe(path.join(root, "packages/safe-bash/src", entry.import.slice("./dist/".length, -3) + ".ts"));
});

it("retains portable contract types and rejects Node-only runtimes", () => {
  for (const route of ["contracts", "contracts/index", "contracts/path"]) {
    const entry = manifest.exports[`./${route}`];
    expect(entry.workerd).toBe(entry.browser);
    expect(entry.types.workerd).toBe(entry.types.browser);
    expect(entry.types.workerd).not.toContain("node");
  }
  for (const route of ["commands/docx", "commands/python", "commands/python/worker"]) {
    expect(manifest.exports[`./${route}`].workerd).toBe(manifest.exports[`./${route}`].browser);
  }
  for (const route of ["node", "commands/python/node", "commands/python/docker"]) {
    expect(manifest.exports[`./${route}`].workerd).toBeNull();
    expect(manifest.exports[`./${route}`].types.workerd).toBe("./dist/node-unavailable.d.ts");
    expect(manifest.exports[`./${route}`].types.browser).toBe("./dist/node-unavailable.d.ts");
  }
});

it("executes every reported subpath in workerd without nodejs_compat", async () => {
  const { build } = await import("esbuild");
  const { Miniflare } = await import("miniflare");
  const recipe = resolveBrowserShellBuild(root);
  const targets = new Set(subpaths.map(route => manifest.exports[`./${route}`].workerd.slice("./dist/".length, -3)));
  const result = await build({ ...recipe, sourcemap: false,
    entryPoints: Object.fromEntries(Object.entries(recipe.entryPoints).filter(([name]) => targets.has(name))),
  });
  const outputs = new Map(result.outputFiles.map(output => [output.path, output.text]));
  const consumer = await build({
    stdin: { contents: `
      import { verifyPortableSubpaths } from './scripts/fixtures/safe-packages-portable-subpaths.mjs';
      export default { async fetch() { await verifyPortableSubpaths(); return new Response('ok'); } };
    `, resolveDir: root },
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "esm",
    alias: { "@poe-platform/safe-fs/core": path.join(root, "packages/safe-fs/src/core.ts"),
      "poe-code/safe-fs/core": path.join(root, "packages/safe-fs/src/core.ts") },
    plugins: [{ name: "portable-artifacts", setup(builder) {
      builder.onResolve({ filter: /^@poe-platform\/safe-bash\// }, args => ({
        path: path.join(root, "packages/safe-bash", manifest.exports[args.path.replace("@poe-platform/safe-bash", ".")].workerd), namespace: "artifact",
      }));
      builder.onResolve({ filter: /^\./, namespace: "artifact" }, args => ({
        path: path.resolve(path.dirname(args.importer), args.path), namespace: "artifact",
      }));
      builder.onLoad({ filter: /.*/, namespace: "artifact" }, args => ({ contents: outputs.get(args.path)!, loader: "js" }));
    } }],
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false,
    script: consumer.outputFiles[0]!.text });
  try {
    const response = await runtime.dispatchFetch("https://portable.test");
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toBe("ok");
  } finally { await runtime.dispose(); }
});

it("resolves portable and Node declarations using TypeScript package conditions", async () => {
  const ts = await import("typescript");
  const { Volume } = await import("memfs");
  const directory = "/consumer/node_modules/@poe-platform/safe-bash";
  const volume = Volume.fromJSON({ [`${directory}/package.json`]: JSON.stringify(manifest) });
  const declarations = ["./dist/node-unavailable.d.ts", "./dist/contracts/index.d.ts", "./dist/contracts/path.d.ts",
    "./dist/contracts/node.d.ts", "./dist/contracts/node-path.d.ts", "./dist/node.d.ts",
    "./dist/commands/python/node.d.ts", "./dist/commands/python/docker.d.ts",
    ...subpaths.map(route => manifest.exports[`./${route}`].types)];
  for (const declaration of declarations) {
    const filename = path.posix.join(directory, declaration);
    volume.mkdirSync(path.posix.dirname(filename), { recursive: true });
    volume.writeFileSync(filename, "export {};\n");
  }
  const host = {
    fileExists: (filename: string) => volume.existsSync(filename),
    readFile: (filename: string) => volume.existsSync(filename) ? volume.readFileSync(filename, "utf8").toString() : undefined,
  };
  for (const condition of ["workerd", "browser", "node"]) {
    for (const route of [...subpaths, "contracts", "contracts/index", "contracts/path", "node", "commands/python/node", "commands/python/docker"]) {
      const types = manifest.exports[`./${route}`].types;
      const expected = typeof types === "string" ? types : types[condition] ?? types.default;
      const result = ts.resolveModuleName(`@poe-platform/safe-bash/${route}`, "/consumer/index.mts", {
        moduleResolution: ts.ModuleResolutionKind.Bundler, customConditions: [condition],
      }, host);
      expect(result.resolvedModule?.resolvedFileName, `${condition}: ${route}`).toBe(path.posix.join(directory, expected));
    }
  }
});
