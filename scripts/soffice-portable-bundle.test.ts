import { build } from "esbuild";
import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";

it("loads the built soffice command in a browser without Node platform initialization", async () => {
  const result = await build({
    stdin: {
      contents: 'import { createSofficeCommand } from "safe-bash-command-soffice"; globalThis.command = createSofficeCommand();',
      resolveDir: process.cwd()
    },
    bundle: true, platform: "browser", format: "iife", write: false,
    conditions: ["workerd", "worker", "browser"], metafile: true, logLevel: "silent"
  });
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  const context = { TextEncoder, TextDecoder, Uint8Array, AbortController, AbortSignal, command: undefined };
  runInNewContext(result.outputFiles[0]!.text, context);
  expect(context.command).toMatchObject({ name: "soffice", execute: expect.any(Function) });
});
