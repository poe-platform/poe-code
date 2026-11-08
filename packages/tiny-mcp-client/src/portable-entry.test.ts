import { build } from "esbuild";
import { expect, it } from "vitest";

it.each(["workerd", "browser"])("bundles HTTP directly under %s without Node shims", async condition => {
  const result = await build({
    entryPoints: ["packages/tiny-mcp-client/src/index.browser.ts"],
    mainFields: ["module", "main"], bundle: true, platform: "neutral", format: "esm", conditions: [condition],
    write: false, metafile: true, logLevel: "silent",
    alias: {
      "toolcraft-schema": "./packages/toolcraft-schema/src/index.ts",
      "mcp-oauth": "./packages/mcp-oauth/src/index.browser.ts",
      "tiny-stdio-mcp-server/protocol": "./packages/tiny-stdio-mcp-server/src/protocol.ts",
      "tiny-stdio-mcp-server/headers": "./packages/tiny-stdio-mcp-server/src/headers.ts"
    }
  });
  expect(Object.keys(result.metafile!.inputs).some(path => path.endsWith("spawn.node.ts") || path.endsWith("stream.node.ts"))).toBe(false);
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
});
