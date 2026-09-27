import { build } from "esbuild";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";

it("runs sharp pixel, stream and safe-fs file workflows without Node globals", async () => {
  const output = await build({
    entryPoints: [new URL("../tests/portable-sharp.ts", import.meta.url).pathname],
    bundle: true, platform: "browser", conditions: ["workerd"],
    format: "iife", globalName: "checks", write: false, logLevel: "silent",
    alias: {
      "@poe-code/safe-fs/core": new URL("../../safe-fs/src/core.ts", import.meta.url).pathname,
      "@poe-code/pdf-ast": new URL("../../pdf-ast/src/index.ts", import.meta.url).pathname,
    },
  });
  const context = createContext({ TextEncoder, TextDecoder, Uint8Array, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, DOMException });
  runInContext(output.outputFiles[0]!.text, context);
  expect(await runInContext("checks.run()", context)).toBe(true);
});
