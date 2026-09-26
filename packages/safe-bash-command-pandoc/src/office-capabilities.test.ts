// Load the lazy Office dependency during collection, outside conversion timeouts.
import "docx";
import {expect, it} from "vitest";
import {createXlsxWriter, type CapabilityContext} from "safe-bash-command-ssconvert";
import {convert, createFormatRegistry, createPandocCommand, readDocument} from "./index.js";
const encode = (text: string) => new TextEncoder().encode(text);
const context = {yield: async () => {}};
it("makes declared Office and PDF directions available without injection", () => {
  const registry = createFormatRegistry();
  for (const format of ["docx", "xlsx", "pdf"]) expect(registry.resolve(format, "read").reader).toBeDefined();
  expect(registry.resolve("docx", "write").writer).toBeDefined();
});
it("round trips headings and styled paragraphs through built-in DOCX", async () => {
  const result = await convert([{bytes: encode("# Orchard\n\n**Apple** and *Pear*")}], {from: "commonmark", to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const doc = await readDocument({bytes: result.bytes}, {from: "docx"}, context);
  expect(doc.blocks[0]).toMatchObject({t: "Header", c: [1, ["", [], []], [{t: "Str", c: "Orchard"}]]});
  expect(JSON.stringify(doc.blocks)).toContain('"t":"Strong"');
  expect(JSON.stringify(doc.blocks)).toContain('"t":"Emph"');
  const plain = await convert([{bytes: result.bytes}], {from: "docx", to: "plain"}, context);
  expect(plain).toMatchObject({kind: "text", text: expect.stringContaining("Apple and Pear")});
});
it("reads XLSX sheet names, sparse cells and cached formulas as tables", async () => {
  const cc: CapabilityContext = {signal: new AbortController().signal, own() {}, environment: {env: {}, locale: "C", timezone: "UTC"},
    limits: {inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 10, operations: 100}};
  const bytes = await createXlsxWriter("2008")({sheets: [{id: "s", name: "Orchard", cells: [
    {row: 0, column: 0, value: {kind: "string", value: "Apple"}},
    {row: 1, column: 1, value: {kind: "number", value: 7}},
    {row: 2, column: 1, formula: "1+2", value: {kind: "number", value: 3}, cachedResult: {kind: "number", value: 3}}
  ]}]}, [], cc);
  const doc = await readDocument({bytes}, {from: "xlsx"}, context);
  expect(doc.blocks.map(b => b.t)).toEqual(["Header", "Table"]);
  expect(JSON.stringify(doc.blocks)).toContain("Apple");
  expect(JSON.stringify(doc.blocks)).toContain('"c":"3"');
  await expect(readDocument({bytes}, {from: "xlsx"}, {...context, limits: {tableColumns: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(readDocument({bytes}, {from: "xlsx"}, {...context, limits: {expandedBytes: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("reads a built-in PDF through the default registry", async () => {
  const pdf = await convert([{bytes: encode("Orchard report")}], {from: "commonmark", to: "pdf"}, context);
  if (pdf.kind !== "binary") throw new Error("Expected PDF");
  const result = await convert([{bytes: pdf.bytes}], {from: "pdf", to: "plain"}, context);
  expect(result).toMatchObject({kind: "text", text: expect.stringContaining("Orchard report")});
});

it("converts DOCX through the command with extension inference and explicit formats", async () => {
  const files = new Map<string, Uint8Array>([["/report.md", encode("# Orchard\n\nApple")]]);
  const errors: string[] = [];
  const output: Uint8Array[] = [];
  const execute = (args: string[]) => createPandocCommand().execute({args, cwd: "/", stdin: [],
    signal: new AbortController().signal,
    readFile: async path => {const bytes = files.get(path); if (!bytes) throw new Error("Missing file"); return bytes;},
    writeFile: async (path, bytes) => {files.set(path, new Uint8Array(bytes));},
    stdout: {write: async bytes => {output.push(new Uint8Array(bytes));}},
    stderr: {write: async bytes => {errors.push(new TextDecoder().decode(bytes));}}});
  expect(await execute(["/report.md", "-o", "/report.docx"])).toEqual({exitCode: 0});
  expect(await execute(["-f", "docx", "-t", "plain", "/report.docx"])).toEqual({exitCode: 0});
  expect(new TextDecoder().decode(output[0])).toContain("Apple");
  expect(errors).toEqual([]);
});
it.each(["docx", "xlsx", "pdf"])("rejects malformed %s with parse diagnostics and respects cancellation", async from => {
  await expect(readDocument({bytes: encode("invalid")}, {from}, context)).rejects.toMatchObject({code: "E_PARSE"});
  const signal = AbortSignal.abort();
  await expect(readDocument({bytes: encode("invalid")}, {from}, {...context, signal})).rejects.toMatchObject({code: "E_CANCELLED"});
});
it("keeps DOCX work and output ceilings and rejects unsupported content", async () => {
  await expect(convert([{bytes: encode("Apple")}], {from: "commonmark", to: "docx"}, {...context, limits: {work: 100}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(convert([{bytes: encode("Apple")}], {from: "commonmark", to: "docx"}, {...context, limits: {outputBytes: 100}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(convert([{bytes: encode("- Apple")}], {from: "commonmark", to: "docx"}, context)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
