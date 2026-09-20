import { expect, it, vi } from "vitest";
import { convert, readDocument } from "./engine.js";
import type { ConversionOptions } from "./types.js";
import { PandocError } from "./errors.js";

const input = (text: string, base?: string) => ({bytes: new TextEncoder().encode(text), ...(base ? {base} : {})});
const empty = {blocks: [], metadata: {}, resources: []};
it("joins Markdown operands in order with final newlines and shared reference scope", async () => {
  const result = await convert([input("[x]"), input("\n[x]: /target")], {from: "commonmark", to: "json"}, {});
  expect(result.kind === "text" && JSON.parse(result.text).blocks[0].c[0].t).toBe("Link");
});
it("rejects multiple JSON inputs before acquiring either operand", async () => {
  const next = vi.fn(async () => ({done: true as const, value: undefined}));
  const source = {chunks: {[Symbol.asyncIterator]: () => ({next})}};
  await expect(convert([source, source], {from: "json", to: "json"}, {})).rejects.toMatchObject({code: "E_OPTION"});
  expect(next).not.toHaveBeenCalled();
});
it("deep merges metadata maps and replaces lists without losing siblings", async () => {
  const result = await convert([input("")], {from: "commonmark", to: "json", metadata: {
    config: {t: "MetaMap", c: {new: {t: "MetaBool", c: true}, list: {t: "MetaList", c: []}}}
  }}, {reader: {format: "commonmark", read: async () => ({...empty, metadata: {
    config: {t: "MetaMap", c: {old: {t: "MetaString", c: "kept"}, list: {t: "MetaList", c: [{t: "MetaString", c: "removed"}]}}}
  }})}});
  expect(result.kind === "text" && JSON.parse(result.text).meta.config.c).toEqual({old: {t: "MetaString", c: "kept"}, new: {t: "MetaBool", c: true}, list: {t: "MetaList", c: []}});
});
it("fails on writer warnings before any destination publication", async () => {
  const publish = vi.fn(async () => {});
  await expect(convert([], {from: "commonmark", to: "plain", failIfWarnings: true} as ConversionOptions, {
    writer: {format: "plain", write: async (_doc, ctx) => {ctx.report({code: "W_RAW_CONTENT", operation: "convert", message: "loss", location: "$.blocks[0]"}); return {kind: "text", text: "partial"};}}, output: {publish}
  })).rejects.toMatchObject({code: "E_WARNINGS", location: "$.blocks[0]"});
  expect(publish).not.toHaveBeenCalled();
});
it("preserves later reader parse locations and never writes earlier results", async () => {
  const publish = vi.fn(async () => {});
  await expect(convert([input("h\na", "first.csv"), input('h\n"bad', "second.csv")], {from: "csv", to: "json"}, {output: {publish}})).rejects.toMatchObject({code: "E_PARSE", format: "csv", location: "second.csv:2:5"});
  expect(publish).not.toHaveBeenCalled();
});
it("maps joined reader errors to the original operand line", async () => {
  await expect(convert([{...input("a"), source: "first.md"}, {...input("b\nc"), source: "second.md"}], {from: "commonmark", to: "json"}, {
    reader: {format: "commonmark", read: async () => {throw new PandocError("E_PARSE", "read", "bad token", "commonmark", "3:2");}}
  })).rejects.toMatchObject({code: "E_PARSE", operation: "convert", format: "commonmark", location: "second.md:2:2"});
});
it("maps joined reader warning locations before warning preflight", async () => {
  await expect(convert([{...input("a"), source: "first.md"}, {...input("b"), source: "second.md"}], {from: "commonmark", to: "json", failIfWarnings: true}, {
    reader: {format: "commonmark", read: async (_input, ctx) => {ctx.report({code: "W_RAW_CONTENT", operation: "read", message: "loss", location: "2:1"}); return empty;}}
  })).rejects.toMatchObject({code: "E_WARNINGS", location: "second.md:1:1"});
});
it("parses bounded strict JSON metadata and preserves syntax locations", async () => {
  const publish = vi.fn(async () => {});
  await expect(convert([], {from: "commonmark", to: "json", metadataFiles: [{...input('{\n "x": }'), base: "broken.json"}]}, {output: {publish}})).rejects.toMatchObject({code: "E_PARSE", format: "json", location: "broken.json:2:7"});
  await expect(convert([], {from: "commonmark", to: "json", metadataFiles: [input('{"x":' + '['.repeat(20) + '0' + ']'.repeat(20) + '}')]}, {limits: {depth: 8}, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(publish).not.toHaveBeenCalled();
});
it("rejects malformed SDK metadata before input acquisition", async () => {
  const next = vi.fn(async () => ({done: true as const, value: undefined}));
  for (const metadata of [{metadataJson: [null]}, {metadata: {title: {t: "Wrong", c: "x"}}}]) {
    await expect(convert([{chunks: {[Symbol.asyncIterator]: () => ({next})}}], {from: "commonmark", to: "json", ...metadata} as unknown as ConversionOptions, {})).rejects.toBeInstanceOf(PandocError);
    expect(next).not.toHaveBeenCalled();
  }
});
it("does not acquire or abort streaming destinations when warning preflight fails", async () => {
  const write = vi.fn(async () => {}), close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  await expect(convert([], {from: "commonmark", to: "plain", failIfWarnings: true}, {output: {write, close, abort}, writer: {format: "plain", write: async (_doc, ctx) => {
    ctx.report({code: "W_RAW_CONTENT", operation: "convert", message: "loss"}); return {kind: "text", text: ""};
  }}})).rejects.toMatchObject({code: "E_WARNINGS"});
  expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(abort).not.toHaveBeenCalled();
});
it("uses the same source diagnostics in read and convert", async () => {
  await expect(readDocument({...input('h\n"bad'), source: "input.csv"}, {from: "csv"}, {})).rejects.toMatchObject({code: "E_PARSE", operation: "read", format: "csv", location: "input.csv:2:5"});
});
it("defines empty operands and rejects binary compositions before reading", async () => {
  for (const inputs of [[], [input("")], [input(""), input("")]]) {
    const result = await convert(inputs, {from: "commonmark", to: "json"}, {});
    expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([]);
  }
  const next = vi.fn(async () => ({done: true as const, value: undefined}));
  const source = {chunks: {[Symbol.asyncIterator]: () => ({next})}};
  await expect(convert([source, source], {from: "epub", to: "json"}, {reader: {format: "epub", read: async () => empty}})).rejects.toMatchObject({code: "E_OPTION"});
  expect(next).not.toHaveBeenCalled();
});
it("keeps document collision diagnostics deterministic and deep-merges maps", async () => {
  const options = {from: "csv", to: "json"};
  const context = {reader: {format: "csv", read: async (source: import("./types.js").Input) => ({...empty, metadata: {
    config: {t: "MetaMap" as const, c: {[source.text!.trim()]: {t: "MetaBool" as const, c: true}}}
  }})}};
  const first = await convert([input("a"), input("b")], options, context);
  expect(await convert([input("a"), input("b")], options, context)).toEqual(first);
  expect(first.diagnostics).toEqual([{code: "W_METADATA_CONFLICT", operation: "convert", message: "Later metadata replaces config", location: "input[1].metadata.config"}]);
  expect(first.kind === "text" && JSON.parse(first.text).meta.config.c).toEqual({a: {t: "MetaBool", c: true}, b: {t: "MetaBool", c: true}});
});
