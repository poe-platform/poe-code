import { build } from "esbuild";
import assert from "node:assert/strict";
import { test } from "node:test";

test("loads in-place yq updates in Workers without Node builtins", async () => {
  const output = await build({
    entryPoints: [new URL("./inplace.ts", import.meta.url).pathname],
    bundle: true, platform: "browser", conditions: ["workerd"],
    format: "esm", write: false, logLevel: "silent",
    external: ["@poe-code/safe-fs/core", "safe-bash-contracts", "safe-bash-contracts/*"],
  });
  assert.ok(!output.outputFiles[0]!.text.includes("node:"));
});
