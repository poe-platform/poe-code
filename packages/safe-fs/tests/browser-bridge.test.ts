import { webcrypto } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("bundles and executes the actual portable bridge without Node globals", async () => {
  const output = await build({
    entryPoints: [fileURLToPath(new URL("./helpers/browser-bridge-checks.ts", import.meta.url))],
    bundle: true, platform: "browser", conditions: ["browser"], format: "iife",
    globalName: "bridgeChecks", target: "es2022", write: false, metafile: true, logLevel: "silent"
  });
  expect(Object.values(output.metafile!.outputs).flatMap(output => output.imports.filter(entry => entry.external))).toEqual([]);
  const context = createContext({ Uint8Array, TextEncoder, TextDecoder, AbortController, AbortSignal, crypto: webcrypto });
  runInContext(output.outputFiles[0]!.text, context);
  const checks = await runInContext("bridgeChecks.runBrowserBridgeChecks()", context) as string[];
  expect(checks).toContain("all 21 bridge operations");
  expect(checks).toContain("comparison preserves original cancellation reason");
});
