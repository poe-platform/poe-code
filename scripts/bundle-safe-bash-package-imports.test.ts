import path from "node:path";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

const root = path.resolve(import.meta.dirname, "..");

it("bundles the portable runtime behind a declaration-only root package import", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const result = await build({
    ...resolveBrowserShellBuild(root, { imports: manifest.imports }),
    entryPoints: undefined,
    inject: [],
    stdin: {
      contents: 'export { hostPlatform } from "#safe-js-platform";',
      resolveDir: path.join(root, "packages/safe-js/src"),
      loader: "ts",
    },
    splitting: false,
    format: "cjs",
    sourcemap: false,
  });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect(imports.filter(edge => edge.external).map(edge => edge.path)).not.toContain("#safe-js-platform");
  const consumer = { exports: { hostPlatform: undefined } };
  runInNewContext(result.outputFiles![0]!.text, { module: consumer, exports: consumer.exports, require: () => ({}), structuredClone, setTimeout });
  expect(consumer.exports.hostPlatform).toBe("workerd");
});

it("retains package imports with a conditional runtime target for the installed consumer", async () => {
  const result = await build({
    ...resolveBrowserShellBuild(root, {
      imports: { "#engine": { types: "./dist/engine.d.ts", browser: "./dist/engine.js", default: null } },
    }),
    entryPoints: undefined,
    inject: [],
    stdin: { contents: 'export { value } from "#engine";', resolveDir: root, loader: "ts" },
    sourcemap: false,
  });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect(imports.filter(edge => edge.external).map(edge => edge.path)).toEqual(["#engine"]);
});
