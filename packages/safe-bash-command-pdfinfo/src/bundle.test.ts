import assert from "node:assert/strict";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

it("keeps the buffered document engine out of retained command consumers", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const result = await build({
    stdin: { contents: 'export { pdfinfoCommands } from "./packages/safe-bash-command-pdfinfo/src/index.ts";', resolveDir: root },
    alias: { "@poe-code/pdf-ast": root + "packages/pdf-ast/src/index.ts" },
    bundle: true, platform: "browser", conditions: ["workerd"], format: "esm", write: false, metafile: true,
  });
  const inputs = Object.values(result.metafile.outputs).flatMap(output => Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([filename]) => filename));
  assert.ok(inputs.some(filename => filename.endsWith("/pdf-ast/src/retained-document.ts")));
  assert.ok(!inputs.some(filename => filename.endsWith("/pdf-ast/src/document.ts")));
});
