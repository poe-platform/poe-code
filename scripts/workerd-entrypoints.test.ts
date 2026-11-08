import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

describe("portable runtime entrypoints", () => {
  for (const entry of [
    "packages/safe-bash/src/shell/extensions/trap/index.ts",
    "packages/safe-bash/src/contracts/node.ts",
    "packages/safe-bash/src/contracts/node-path.ts",
    "packages/safe-bash/src/commands/node/browser.ts",
    "packages/safe-bash-command-shuf/src/random.ts",
    "packages/safe-bash/src/commands/regex-execution/matching.ts",
    "packages/safe-bash-zip-engine/src/zip/aes.ts",
    "packages/image-ast/src/index.ts",
  ]) it(`${entry} bundles without Node builtins`, async () => {
    await build({
      absWorkingDir: root.pathname, entryPoints: [entry], bundle: true,
      conditions: ["workerd"],
      platform: "neutral", format: "esm", write: false,
      plugins: [{ name: "reject-node", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (builtins.has(args.path)) return { errors: [{ text: `Node builtin: ${args.path}` }] };
          return undefined;
        });
      } }],
    });
  });
});

// Ask the ESM resolver itself: import is active together with workerd.
describe("workerd conditional exports", () => {
  for (const directory of ["safe-bash", "safe-fs"]) {
    const pkg = JSON.parse(readFileSync(new URL(`packages/${directory}/package.json`, root), "utf8"));
    for (const [subpath, conditions] of Object.entries(pkg.exports) as [string, Record<string, unknown>][]) {
      if (!conditions || !("browser" in conditions) || subpath.includes("*")) continue;
      it(`${pkg.name}${subpath.slice(1)} selects its portable export`, () => {
        const specifier = pkg.name + subpath.slice(1);
        const result = execFileSync(process.execPath, ["--conditions=workerd", "--input-type=module", "-e",
          `try { console.log(import.meta.resolve(${JSON.stringify(specifier)})); } catch (error) { console.log(error.code); }`
        ], { cwd: root, encoding: "utf8" }).trim();
        if (conditions.browser === null) expect(result).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
        else expect(result.endsWith(String(conditions.browser).slice(1))).toBe(true);
      });
    }
  }
});

describe("built portable entrypoints", () => {
  for (const specifier of [
    "@poe-platform/safe-bash/contracts", "@poe-platform/safe-bash/contracts/index",
    "@poe-platform/safe-bash/contracts/path", "@poe-platform/safe-bash/commands/op",
    "@poe-platform/safe-bash/contracts/node", "@poe-platform/safe-bash/contracts/node-path",
    "@poe-platform/safe-bash/commands/node",
    "@poe-platform/safe-bash/trap", "@poe-platform/safe-bash/shuf",
    "@poe-platform/safe-bash/read", "@poe-platform/safe-bash/mapfile",
    "@poe-platform/safe-bash/yes", "@poe-platform/safe-bash/dd",
    "safe-bash-command-xz", "@poe-code/image-ast",
    "auth-store", "auth-store/portable", "mcp-oauth", "tiny-mcp-client",
    "safe-bash-command-mcp", "safe-bash-command-pandoc", "safe-bash-command-ssconvert",
    "@poe-code/safe-js",
    "@poe-platform/safe-bash/core", "@poe-code/safe-fs/fs/s3",
    "safe-bash-command-yq", "safe-bash-command-imagemagick", "safe-bash-command-sips",
    "@poe-code/pdf-ast",
    ...["pdfimages", "pdfinfo", "pdftk", "pdftoppm", "pdftotext", "qpdf", "soffice", "wkhtmltopdf"].map(name => `safe-bash-command-${name}`),
  ]) it(`${specifier} bundles for workerd`, async () => {
    const result = await build({
      absWorkingDir: root.pathname,
      stdin: { contents: `export * from ${JSON.stringify(specifier)};`, resolveDir: root.pathname },
      alias: { "@poe-platform/safe-fs": "@poe-code/safe-fs", "poe-code/safe-fs/core": "@poe-code/safe-fs/core" },
      tsconfigRaw: {},
      bundle: true, platform: "browser", conditions: ["workerd"], format: "esm", write: false,
      // Match the production workerd bundler: Wasm imports retain module assets.
      loader: { ".wasm": "copy" }, outdir: new URL("out/workerd-entrypoints/", root).pathname,
    });
    for (const file of result.outputFiles.filter(file => file.path.endsWith(".wasm")))
      expect(WebAssembly.validate(file.contents)).toBe(true);
  });
  it("the default image bundle has no Node builtins", async () => {
    await build({
      absWorkingDir: root.pathname, entryPoints: ["packages/image-ast/dist/index.js"],
      bundle: true, platform: "browser", format: "esm", write: false,
    });
  });
});

// Package-level consumers must resolve shipped JavaScript, never development sources.
describe("safe-fs platform runtime imports", () => {
  for (const condition of ["workerd", "browser", "worker", "node"]) {
    it(`resolves compiled platform code under ${condition}`, () => {
      const result = execFileSync(process.execPath, [`--conditions=${condition}`, "--input-type=module", "-e",
        'console.log(import.meta.resolve("#safe-fs-platform"));'
      ], { cwd: new URL("packages/safe-fs/", root), encoding: "utf8" }).trim();
      const profile = condition === "node" ? "node" : "browser";
      expect(result).toBe(new URL(`packages/safe-fs/dist/platform/${profile}.js`, root).href);
    });
  }
});

it.each(["poe-code/safe-js/core", "poe-code/safejs/core"])("%s exposes the portable core to browser consumers", specifier => {
  const resolved = execFileSync(process.execPath, ["--conditions=browser", "--input-type=module", "-e",
    `console.log(import.meta.resolve(${JSON.stringify(specifier)}));`
  ], { cwd: root, encoding: "utf8" }).trim();
  expect(resolved).toBe(new URL("packages/safe-js/dist/core.js", root).href);
});
