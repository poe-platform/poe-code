import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { resolveSpreadsheetSdkBuilds } from "./bundle-spreadsheets.mjs";

it("bundles the public Python codecs without private workspace imports", async () => {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const recipe = resolveSpreadsheetSdkBuilds(root, {}, manifest)
    .find(options => options.entryPoints["codecs/python"]);
  expect(recipe).toBeDefined();
  const result = await build({ ...recipe, entryPoints: { "codecs/python": recipe.entryPoints["codecs/python"] }, write: false, sourcemap: false, metafile: true });
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  const runtime = result.outputFiles!.find(file => file.path.endsWith("/codecs/python.js"))!;
  const { pythonCodecs, resolveCodec } = await import(`data:text/javascript;base64,${Buffer.from(runtime.contents).toString("base64")}`);
  const { codec, encoding } = resolveCodec(pythonCodecs, "utf_16");
  const chunks = [Uint8Array.of(255), Uint8Array.of(254, 65), Uint8Array.of(0)];
  let text = "";
  for await (const part of codec.decodeStream(chunks, encoding, new AbortController().signal)) text += part;
  expect(text).toBe("A");
});
