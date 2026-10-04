import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createLuaFilterCapability} from "./lua-filters.js";
import type {ConversionOptions, InputSource, FilterCapability} from "./types.js";

const encoder = new TextEncoder();
const sources = {
  json: '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"one"}]}]}',
  rtf: String.raw`{\rtf1 one}`,
  csv: 'one two,three\nfour,five',
  tsv: 'one two\tthree\nfour\tfive'
};
it.each(Object.entries(sources).flatMap(([from, source]) => ["none", "typed", "raw", "file", "variables"].map(kind => ({from, source, kind}))))
("preserves every text threshold for $from with $kind metadata", async ({from, source, kind}) => {
  const options: ConversionOptions = {from, to: "json",
    ...(kind === "typed" ? {metadata: {nested: {t: "MetaMap" as const, c: {list: {t: "MetaList" as const, c: [{t: "MetaString" as const, c: "value"}]}}}}} : {}),
    ...(kind === "raw" ? {metadataJson: [{nested: {list: ["value"]}}]} : {}),
    ...(kind === "file" ? {metadataFiles: [{bytes: encoder.encode('{"nested":{"list":["value"]}}'), source: "meta.json"}]} : {}),
    ...(kind === "variables" ? {variables: {nested: {list: ["value"]}}} : {})};
  for (let text = 0; text < 350; text++) {
    const inputs = [{bytes: encoder.encode(source), source: `/input.${from}`}];
    await compare(inputs, options, text);
  }
});

async function compare(inputs: InputSource[], options: ConversionOptions, text: number, filters?: FilterCapability) {
  const expected = await convert(inputs, options, {limits: {text}, ...(filters ? {filters} : {})}).catch(error => error);
  const fs = new MemoryFileSystem(); let output = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    const actual = await convertToOutput(inputs, options, {limits: {text}, ...(filters ? {filters} : {}), workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}}).catch(error => error);
    expect(acquire, `text=${text}`).not.toHaveBeenCalled();
    if (expected instanceof Error) expect(actual, `text=${text}`).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
    else {expect(actual, `text=${text}`).not.toBeInstanceOf(Error); expect(output).toBe(expected.text);}
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}

it.each(["rtf-resources", "multi-csv", "empty-json", "unknown", "unicode", "enum", "metadata-null"])("preserves text budgets for %s", async kind => {
  let from = "json", source = sources.json, count = 1;
  if (kind === "rtf-resources") {from = "rtf"; source = String.raw`{\rtf1 before{\pict\pngblip 89504e470d0a1a0a}after{\pict\pngblip 89504e470d0a1a0a}}`;}
  if (kind === "multi-csv") {from = "csv"; source = "one\ntwo"; count = 2;}
  if (kind === "empty-json") source = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}';
  if (kind === "unknown") source = source.replace('"Para"', '"Unknown"');
  if (kind === "unicode") source = source.replace('"one"', '"\\ud800"');
  if (kind === "enum") source = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Math","c":[{"t":"InlineMath"},"x"]}]}]}';
  const options: ConversionOptions = {from, to: "plain", lossy: true, ...(kind === "metadata-null" ? {metadataJson: [{value: [null]}]} : {})};
  for (let text = 0; text < 350; text++) await compare(Array.from({length: count}, () => ({bytes: encoder.encode(source), source: "/input"})), options, text);
});

it.each(["json", "rtf"])("retains %s text budgets with real Lua filters", async from => {
  const source = sources[from as "json" | "rtf"];
  for (const text of [0, 8, 16, 24, 32, 48, 64, 100, 256, 1024]) {
    const filters = createLuaFilterCapability({readStream: () => [encoder.encode("function Str(el) el.text = string.upper(el.text); return el end")]});
    await compare([{bytes: encoder.encode(source), source: "/input"}], {from, to: "json", filters: [{kind: "lua", path: "/filter.lua"}]}, text, filters);
  }
});

it.each(["unsafe", "symbol", "cycle", "sparse", "accessor"])("preserves typed metadata descriptor precedence with text limits (%s)", async kind => {
  const metadata: Record<string | symbol, unknown> = {value: {t: "MetaString", c: "value"}};
  if (kind === "unsafe") Object.defineProperty(metadata, "constructor", {enumerable: true, value: {t: "MetaString", c: "bad"}});
  if (kind === "symbol") metadata[Symbol("extra")] = true;
  if (kind === "cycle") metadata.loop = metadata;
  if (kind === "sparse") metadata.value = {t: "MetaList", c: new Array(1)};
  if (kind === "accessor") Object.defineProperty(metadata, "value", {enumerable: true, get() {throw new Error("Getter must not execute");}});
  for (let text = 0; text < 100; text++) await compare([{bytes: encoder.encode(sources.json)}], {from: "json", to: "json", metadata: metadata as NonNullable<ConversionOptions["metadata"]>}, text);
});

it.each(["json", "csv", "tsv"])("preserves UTF-8 versus text-budget precedence for %s", async from => {
  const bad = Uint8Array.from([...encoder.encode("valid prefix"), 255]);
  for (const chunks of [false, true]) for (const text of [0, 1, 5, 12, 30]) {
    const input: InputSource = chunks ? {chunks: [bad.subarray(0, 4), bad.subarray(4)], source: "/bad"} : {bytes: bad, source: "/bad"};
    await compare([input], {from, to: "plain"}, text);
  }
});

it("finishes bounded input decoding before parsing malformed JSON", async () => {
  const bytes = encoder.encode("invalid" + " ".repeat(20000));
  for (const text of [10, 17000]) await compare([{chunks: [bytes.subarray(0, 16), bytes.subarray(16)], source: "/bad.json"}], {from: "json", to: "plain"}, text);
});

it.each(["json", "rtf", "csv", "tsv"])("preserves %s text across backing pages and UTF-8 chunk boundaries", async from => {
  const value = "😀word ".repeat(1000);
  const source = from === "json" ? JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: value}]}]})
    : from === "rtf" ? String.raw`{\rtf1\ansicpg65001 ` + value + "}" : value + "\r\n";
  const bytes = encoder.encode(source);
  const chunks = Array.from({length: Math.ceil(bytes.length / 127)}, (_, index) => bytes.subarray(index * 127, (index + 1) * 127));
  for (const text of [1, 7000, 100000]) await compare([{chunks, source: "/input"}], {from, to: "plain"}, text);
});

it("preserves metadata decoding error order under cumulative text limits", async () => {
  const bad = Uint8Array.from([...encoder.encode("x".repeat(400)), 255]);
  for (const text of [100, 200, 400, 1000]) await compare([{bytes: encoder.encode(sources.json)}], {from: "json", to: "plain", metadataFiles: [{bytes: bad, source: "/bad.json"}]}, text);
});

it.each(["csv", "tsv"])("validates zero-input %s text budgets without charging the aggregate", async from => {
  for (const text of [0, 1, 6, 14, 22, 23, 30, 50, 100]) for (const options of [{from, to: "json"}, {from, to: "html", metadataJson: [{title: "value"}]}]) await compare([], options, text);
});
