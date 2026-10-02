import { build } from "esbuild";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";

it.each(["index", "portable"])("runs %s sharp pixel, stream and safe-fs file workflows without Node globals", async entry => {
  const output = await build({
    entryPoints: [new URL("../tests/portable-sharp.ts", import.meta.url).pathname],
    bundle: true, platform: "browser", conditions: ["workerd"],
    format: "iife", globalName: "checks", write: false, logLevel: "silent",
    alias: {
      "@poe-code/image-ast/portable": new URL(`./${entry}.ts`, import.meta.url).pathname,
      "@poe-code/safe-fs/core": new URL("../../safe-fs/src/core.ts", import.meta.url).pathname,
      "@poe-code/pdf-ast": new URL("../../pdf-ast/src/index.ts", import.meta.url).pathname,
    },
  });
  const context = createContext({ TextEncoder, TextDecoder, Uint8Array, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, DOMException });
  runInContext(output.outputFiles[0]!.text, context);
  expect(await runInContext("checks.run()", context)).toBe(true);
});

it.each(["sips", "imagemagick"])("imports the %s command without Node builtins or globals", async command => {
  const output = await build({
    entryPoints: [new URL(`../../safe-bash-command-${command}/src/index.ts`, import.meta.url).pathname],
    bundle: true, platform: "browser", conditions: ["workerd"],
    format: "iife", globalName: "commands", write: false, logLevel: "silent",
    alias: {
      "@poe-code/image-ast": new URL("./", import.meta.url).pathname,
      "@poe-code/pdf-ast": new URL("../../pdf-ast/src/index.ts", import.meta.url).pathname,
      "@poe-code/safe-fs": new URL("../../safe-fs/src/", import.meta.url).pathname,
      "safe-bash-contracts": new URL("../../safe-bash-contracts/src/", import.meta.url).pathname,
    },
  });
  const context = createContext({ TextEncoder, TextDecoder, Uint8Array, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, DOMException, btoa, atob });
  runInContext(output.outputFiles[0]!.text, context);
  expect(runInContext(`typeof commands.${command}Commands`, context)).toBe("function");
  expect(runInContext('"Buffer" in globalThis || "process" in globalThis', context)).toBe(false);
});
