import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build, type BuildResult } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import type { Document, FilterCapability } from "../packages/safe-bash-command-pandoc/src/types.js";
import { ExecutionContext } from "../packages/safe-bash-command-pandoc/src/execution.js";
import * as filesystem from "../packages/safe-fs/src/core.js";

let result: BuildResult;
beforeAll(async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const options = resolveBrowserShellBuild(root);
  result = await build({
    ...options, entryPoints: undefined, splitting: false, sourcemap: false,
    format: "cjs", logLevel: "silent",
    stdin: {
      contents: 'export { createLuaFilterCapability } from "safe-bash-command-pandoc/lua-filters";',
      resolveDir: path.join(root, "packages/safe-bash")
    }
  });
});

it("uses prepared Pandoc adapters in the standalone browser shell build", async () => {
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect([...new Set(imports.map(entry => entry.path))]).toEqual(["poe-code/safe-fs/core"]);
  const module = { exports: {} as {
    createLuaFilterCapability: (load: () => Promise<Uint8Array>) => FilterCapability;
  } };
  runInNewContext(result.outputFiles![0]!.text, {
    module, Uint8Array, TextEncoder, TextDecoder,
    require(name: string) {
      expect(name).toBe("poe-code/safe-fs/core");
      return filesystem;
    }
  });
  const filter = module.exports.createLuaFilterCapability(async () => new TextEncoder().encode(
    'function Str(el) el.text = string.upper(el.text); return el end'
  ));
  const document: Document = { metadata: {}, resources: [], blocks: [{ t: "Para", c: [{ t: "Str", c: "Hello" }] }] };
  const filtered = await filter.apply(document, { kind: "lua", path: "filter.lua" },
    Object.assign(new ExecutionContext("convert", {}), { to: "html" }));
  expect(filtered.blocks).toEqual([{ t: "Para", c: [{ t: "Str", c: "HELLO" }] }]);
});
