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
    "packages/safe-bash/src/commands/shuf/random.ts",
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
    "@poe-platform/safe-bash/trap", "@poe-platform/safe-bash/shuf",
    "safe-bash-command-xz", "@poe-code/image-ast",
  ]) it(`${specifier} bundles for workerd`, async () => {
    await build({
      absWorkingDir: root.pathname,
      stdin: { contents: `export * from ${JSON.stringify(specifier)};`, resolveDir: root.pathname },
      bundle: true, platform: "browser", conditions: ["workerd"], format: "esm", write: false,
    });
  });
  it("the default image bundle has no Node builtins", async () => {
    await build({
      absWorkingDir: root.pathname, entryPoints: ["packages/image-ast/dist/index.js"],
      bundle: true, platform: "browser", format: "esm", write: false,
    });
  });
});
