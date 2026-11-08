import { build } from "esbuild";
import { decode } from "jpeg-js";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";

async function worker(entry: string) {
  const output = await build({ entryPoints: [entry], bundle: true, platform: "browser",
    conditions: ["workerd"], format: "iife", globalName: "sdk", write: false, logLevel: "silent" });
  const realm = createContext({ TextEncoder, TextDecoder, Uint8Array, AbortController, AbortSignal, atob, btoa, URL, crypto: globalThis.crypto, performance });
  runInContext(output.outputFiles![0]!.text, realm);
  expect(runInContext("typeof Buffer + ':' + typeof process + ':' + typeof require", realm)).toBe("undefined:undefined:undefined");
  return realm;
}

it("encodes a JPEG without Buffer or any Node globals", async () => {
  const realm = await worker("packages/spreadsheet-engine/src/rendering/images/codecs.ts");
  const bytes = await runInContext(`sdk.encodeGraphImage({ width: 4, height: 4, commands: [],
    raster: { width: 4, height: 4, rgba: new Uint8Array(64) } }, "jpeg", {
    signal: new AbortController().signal, limits: { outputBytes: Infinity, imageWidth: Infinity,
    imageHeight: Infinity, imagePixels: Infinity, renderCommands: Infinity, workbookWork: Infinity } })`, realm) as Uint8Array;
  expect(Array.from(bytes.slice(0, 2))).toEqual([255, 216]);
  expect(Array.from(bytes.slice(-2))).toEqual([255, 217]);
  const image = decode(bytes, {useTArray: true});
  expect([image.width, image.height]).toEqual([4, 4]);
  expect(Array.from(image.data)).toEqual(Array(64).fill(255));
});

it.each(["loader", "reader"])("bundles and executes genuine Lua through the %s capability without Node globals", async mode => {
  const realm = await worker("packages/safe-bash-command-pandoc/src/lua-filters.ts");
  realm.reader = mode === "reader";
  const result = await runInContext(`(async () => {
    const load = async () => new TextEncoder().encode('assert(io == nil and os == nil and package == nil and debug == nil); function Str(el) el.text = string.upper(el.text); return el end');
    const capability = sdk.createLuaFilterCapability(reader ? { readFile: load } : load);
    return capability.apply({ blocks: [{t: "Para", c: [{t: "Str", c: "hello"}]}], metadata: {}, resources: [] },
      {kind: "lua", path: "filter.lua"}, {to: "html", checkpoint() {}, charge() {}, bound() {}, async cooperate() {} });
  })()`, realm);
  expect(result).toMatchObject({blocks: [{t: "Para", c: [{t: "Str", c: "HELLO"}]}]});
});

it.each(["pandoc", "ssconvert"])("initializes the public %s package in a Worker without Node modules or globals", async name => {
  const realm = await worker(`packages/safe-bash-command-${name}/dist/index.js`);
  expect(runInContext(`typeof sdk.${name === "pandoc" ? "createPandocCommand" : "createSsconvertCommand"}`, realm)).toBe("function");
});
