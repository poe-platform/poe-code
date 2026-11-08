import { build } from "esbuild";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

for (const condition of ["workerd", "browser"]) describe(`portable S3 (${condition})`, () => {
  it("runs S3 reads, conditional writes and scoped budgets without Node globals", async () => {
    const output = await build({
      entryPoints: [new URL("./helpers/portable-s3-checks.ts", import.meta.url).pathname],
      bundle: true, platform: "browser", conditions: [condition],
      format: "iife", globalName: "checks", write: false, logLevel: "silent",
    });
    const context = createContext({ crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, structuredClone,
      AbortController, AbortSignal, ReadableStream, setTimeout, clearTimeout, DOMException });
    runInContext(output.outputFiles[0]!.text, context);
    expect(await runInContext("checks.run()", context)).toBe(true);
  });
});
