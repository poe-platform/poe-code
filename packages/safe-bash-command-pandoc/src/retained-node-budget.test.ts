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
("preserves every node threshold for $from with $kind metadata", async ({from, source, kind}) => {
  const options: ConversionOptions = {from, to: "json",
    ...(kind === "typed" ? {metadata: {nested: {t: "MetaMap" as const, c: {list: {t: "MetaList" as const, c: [{t: "MetaString" as const, c: "value"}]}}}}} : {}),
    ...(kind === "raw" ? {metadataJson: [{nested: {list: ["value"]}}]} : {}),
    ...(kind === "file" ? {metadataFiles: [{bytes: encoder.encode('{"nested":{"list":["value"]}}'), source: "meta.json"}]} : {}),
    ...(kind === "variables" ? {variables: {nested: {list: ["value"]}}} : {})};
  for (let nodes = 0; nodes < (from === "csv" || from === "tsv" ? 200 : 70); nodes++) {
    const inputs = [{bytes: encoder.encode(source), source: `/input.${from}`}];
    await compare(inputs, options, nodes);
  }
});

async function compare(inputs: InputSource[], options: ConversionOptions, nodes: number, filters?: FilterCapability) {
  const expected = await convert(inputs, options, {limits: {nodes}, ...(filters ? {filters} : {})}).catch(error => error);
  const fs = new MemoryFileSystem(); let output = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    const actual = await convertToOutput(inputs, options, {limits: {nodes}, ...(filters ? {filters} : {}), workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}}).catch(error => error);
    expect(acquire, `nodes=${nodes}`).not.toHaveBeenCalled();
    if (expected instanceof Error) expect(actual, `nodes=${nodes}`).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
    else {expect(actual, `nodes=${nodes}`).not.toBeInstanceOf(Error); expect(output).toBe(expected.text);}
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}

it.each(["rtf-resources", "multi-csv", "empty-json", "unknown", "unicode", "enum", "metadata-null"])("preserves node budgets for %s", async kind => {
  let from = "json", source = sources.json, count = 1;
  if (kind === "rtf-resources") {from = "rtf"; source = String.raw`{\rtf1 before{\pict\pngblip 89504e470d0a1a0a}after{\pict\pngblip 89504e470d0a1a0a}}`;}
  if (kind === "multi-csv") {from = "csv"; source = "one\ntwo"; count = 2;}
  if (kind === "empty-json") source = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}';
  if (kind === "unknown") source = source.replace('"Para"', '"Unknown"');
  if (kind === "unicode") source = source.replace('"one"', '"\\ud800"');
  if (kind === "enum") source = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Math","c":[{"t":"InlineMath"},"x"]}]}]}';
  const options: ConversionOptions = {from, to: "plain", lossy: true, ...(kind === "metadata-null" ? {metadataJson: [{value: [null]}]} : {})};
  for (let nodes = 0; nodes < 150; nodes++) await compare(Array.from({length: count}, () => ({bytes: encoder.encode(source), source: "/input"})), options, nodes);
});

it.each(["json", "rtf"])("retains %s node budgets with real Lua filters", async from => {
  const source = sources[from as "json" | "rtf"];
  for (const nodes of [0, 8, 16, 24, 32, 48, 64, 100, 256, 1024]) {
    const filters = createLuaFilterCapability({readStream: () => [encoder.encode("function Str(el) el.text = string.upper(el.text); return el end")]});
    await compare([{bytes: encoder.encode(source), source: "/input"}], {from, to: "json", filters: [{kind: "lua", path: "/filter.lua"}]}, nodes, filters);
  }
});

it.each(["unsafe", "symbol", "cycle", "sparse", "accessor"])("preserves typed metadata descriptor precedence with node limits (%s)", async kind => {
  const metadata: Record<string | symbol, unknown> = {value: {t: "MetaString", c: "value"}};
  if (kind === "unsafe") Object.defineProperty(metadata, "constructor", {enumerable: true, value: {t: "MetaString", c: "bad"}});
  if (kind === "symbol") metadata[Symbol("extra")] = true;
  if (kind === "cycle") metadata.loop = metadata;
  if (kind === "sparse") metadata.value = {t: "MetaList", c: new Array(1)};
  if (kind === "accessor") Object.defineProperty(metadata, "value", {enumerable: true, get() {throw new Error("Getter must not execute");}});
  for (let nodes = 0; nodes < 32; nodes++) await compare([{bytes: encoder.encode(sources.json)}], {from: "json", to: "json", metadata: metadata as NonNullable<ConversionOptions["metadata"]>}, nodes);
});
