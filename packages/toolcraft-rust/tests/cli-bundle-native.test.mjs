import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("basic native CLI bundles leave optional MCP discovery lazy", async () => {
  const result = await build({
    stdin: {
      contents: 'export {runCLI} from "./cli.js";',
      resolveDir: fileURLToPath(new URL("../dist/", import.meta.url)),
      sourcefile: "native-cli-consumer.mjs"
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    packages: "external",
    metafile: true,
    write: false,
    logLevel: "silent"
  });
  assert.ok(result.outputFiles[0].text.includes("runCLI"));
  assert.equal(Object.keys(result.metafile.inputs).some(input => input.endsWith("/mcp-proxy.js")), false);
  for (const output of Object.values(result.metafile.outputs)) {
    assert.equal(output.imports.some(entry => entry.path === "tiny-mcp-client-rust"), false);
  }
});
