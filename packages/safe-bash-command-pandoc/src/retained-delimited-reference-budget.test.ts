import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {InputSource, Limits} from "./types.js";

it.each(["csv", "tsv"].flatMap(from => ["empty", "one", "ragged", "words", "quoted", "malformed", "zero", "multiple"].map(kind => ({from, kind}))))
("retains $from reference limits with $kind input", async ({from, kind}) => {
  const delimiter = from === "csv" ? "," : "\t";
  const source = kind === "empty" ? "" : kind === "one" ? "one" : kind === "ragged" ? `one${delimiter}two\nthree\nfour${delimiter}five${delimiter}six`
    : kind === "words" ? `one two${delimiter}three  four\n${delimiter}` : kind === "quoted" ? `"one\ntwo"${delimiter}"three"` : kind === "malformed" ? '"unclosed' : `one${delimiter}two\nthree${delimiter}four`;
  const inputs = Array.from({length: kind === "zero" ? 0 : kind === "multiple" ? 2 : 1}, (_, index) => ({bytes: new TextEncoder().encode(source), source: `/input-${index}.${from}`}));
  for (let references = 0; references < 100; references++) await compare(inputs, from, {references});
});

async function compare(inputs: InputSource[], from: string, limits: Partial<Limits>) {
  const options = {from, to: "json"};
  const expected = await convert(inputs, options, {limits}).catch(error => error);
  const fs = new MemoryFileSystem(); let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    const actual = await convertToOutput(inputs, options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
    }}).catch(error => error);
    expect(acquire.mock.calls.length, JSON.stringify(limits)).toBe(0);
    if (expected instanceof Error) {
      expect(actual, JSON.stringify(limits)).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
      expect(text).toBe("");
    } else {expect(actual, JSON.stringify(limits)).not.toBeInstanceOf(Error); expect(text).toBe(expected.text);}
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
}

it.each(["csv", "tsv"].flatMap(from => [
  {inputBytes: 0}, {inputBytes: 10}, {nodes: 8}, {nodes: 32}, {nodes: 128}, {text: 20}, {text: 60},
  {depth: 3}, {depth: 10}, {attributes: 3}, {attributes: 10}, {tableCells: 2}, {tableCells: 8}, {tableRows: 1}, {tableColumns: 1}, {tableFieldText: 2}
].map(limits => ({from, limits}))))("preserves $from mixed reference-budget error order: $limits", async ({from, limits}) => {
  const source = "one two" + (from === "csv" ? "," : "\t") + "three\nfour";
  const inputs = [0, 1].map(index => ({bytes: new TextEncoder().encode(source), source: `/input-${index}.${from}`}));
  for (const references of [0, 2, 4, 8, 16, 24, 32, 64, 128]) await compare(inputs, from, {...limits, references});
});

it.each(["csv", "tsv"])("preserves %s reference accounting across UTF-8 and backing-page boundaries", async from => {
  const bytes = new TextEncoder().encode("😀".repeat(5000));
  const chunks = Array.from({length: Math.ceil(bytes.length / 127)}, (_, index) => bytes.subarray(index * 127, (index + 1) * 127));
  for (const references of [0, 1, 2, 4, 8, 16, 32, 64, 128]) await compare([{chunks, source: "/input"}], from, {references});
});
