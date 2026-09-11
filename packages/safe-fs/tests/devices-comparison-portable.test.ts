import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { deviceComparisonChecks } from "./helpers/device-comparison-checks.js";

const expected = ["unknown", "unknown", "unknown", "unknown", "same", "same", "distinct"];

it("compares devices with identity-less backends in the native graph", async () => {
  expect(await deviceComparisonChecks()).toEqual(expected);
});

for (const condition of ["browser", "workerd"]) {
  it(`compares devices without Node callback authority under ${condition} selection`, async () => {
    const output = await build({
      entryPoints: [fileURLToPath(new URL("./helpers/device-comparison-checks.ts", import.meta.url))],
      bundle: true,
      platform: "browser",
      conditions: [condition],
      format: "iife",
      globalName: "deviceChecks",
      target: "es2022",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    expect(Object.values(output.metafile!.inputs).flatMap(input => input.imports).filter(input => input.external)).toEqual([]);
    expect(Object.keys(output.metafile!.inputs).some(input => input.endsWith("platform/browser.ts"))).toBe(true);
    expect(Object.keys(output.metafile!.inputs).some(input => input.endsWith("platform/node.ts"))).toBe(false);
    const context = createContext({ AbortController, AbortSignal, TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto });
    runInContext(output.outputFiles[0]!.text, context);
    expect(await runInContext("deviceChecks.deviceComparisonChecks()", context)).toEqual(expected);
  });
}
