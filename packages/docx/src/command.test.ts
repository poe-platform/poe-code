import { describe, expect, it } from "vitest";
import { parseDocxArguments, validateDocxInvocation, validateDocxBatch, createDocxCommandEngine } from "./command.js";
import { Volume } from "memfs";
import { DocxUsageError } from "./argument-json.js";
import { ResourceLimitError } from "./archive.js";

const argv = (...args: string[]) => args.map(value => new TextEncoder().encode(value));
const parse = (...args: string[]) => parseDocxArguments(argv(...args));

describe("document literal command grammar", () => {
  it.each([
    ["text.get", "/coast.docx"],
    ["help", "text.get"]
  ])("rejects dotted CLI path aliases before I/O: %j", async (...words) => {
    const volume = Volume.fromJSON({ "/coast.docx": "original coast" });
    let reads = 0;
    let calls = 0;
    const engine = createDocxCommandEngine({
      async readSource(source) { reads++; return Uint8Array.from(volume.readFileSync(source.path) as Uint8Array); },
      async execute() { calls++; volume.writeFileSync("/coast.docx", "dispatched"); return { exitCode: 0 }; }
    });
    const result = await engine.execute({ args: argv(...words), stdin: { async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array([0xff]); } }, stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal });
    expect(result.exitCode).toBe(2);
    expect(reads).toBe(0);
    expect(calls).toBe(0);
    expect(volume.readFileSync("/coast.docx", "utf8")).toBe("original coast");
  });

  it("retains Unicode paths, leading dashes and literal replacement data", () => {
    const result = parse("text", "replace", "--find", "$(ignored) 'shore'", "--with=", "--all", "-o=résumé.docx", "--", "-海岸.docx");
    expect(result.operation).toBe("text.replace");
    expect(result.inputs).toEqual(["-海岸.docx"]);
    expect(result.options).toMatchObject({ find: "$(ignored) 'shore'", with: "", all: true, output: "résumé.docx" });
    expect(parse("text", "海岸.docx").operation).toBe("text.get");
    expect(parse("text", "get", "coast.report.docx").inputs).toEqual(["coast.report.docx"]);
    expect(parse("schema", "--operation", "text.get").options.operation).toBe("text.get");
  });
  it.each([
    [], ["--help"], ["-h"], ["help"], ["text", "replace", "--help"]
  ])("supports discovery without input: %j", (...args) => {
    expect(parse(...args).operation).toBe("help");
  });
  it.each([
    ["replace", "file"], ["image", "list", "file"], ["text"],
    ["text", "file", "--input", "other"], ["inspect", "file", "--output", "out"],
    ["text", "file", "--json=true"], ["text", "file", "--json", "--json"],
    ["create", "--output", "a", "-o", "b"], ["create", "-oout"],
    ["text", "replace", "file", "--find", "", "--with", "x", "--all", "--dry-run"],
    ["text", "replace", "file", "--find", "x", "--with", "y", "--dry-run"],
    ["text", "replace", "file", "--find", "x", "--with", "y", "--first", "--all", "--dry-run"],
    ["text", "file", "--run", "1"], ["text", "file", "--paragraph", "0"],
    ["text", "file", "--paragraph", " 1"], ["text", "file", "--scope", "everywhere"],
    ["text", "file", "--cell", "b2"], ["text", "file", "--cell", "B2"],
    ["text", "file", "--paragraph", "1", "--image", "1", "--link", "1"],
    ["xml", "get", "file", "--part", "/word/document.xml", "--raw", "--json"],
    ["create", "--output", "-", "--json"], ["create", "--in-place"],
    ["create", "--output", "-", "--force"], ["create", "--output", ""],
    ["batch", "-", "--ops-file", "-", "--dry-run"], ["diff", "-", "-"],
    ["batch", "file", "--ops-json", "{}", "--ops-file", "ops"],
    ["help", "unknown"], ["text", "--help", "--unknown"], ["--version", "--help"],
    ["create", "--content-json", '{"version":1,"blocks":[],"extra":true}', "--help"],
    ["text", "file", "--limit", "xmlDepth=2", "--limit", "xmlDepth=3"]
  ])("rejects invalid arguments before dispatch: %j", (...args) => {
    expect(() => parse(...args)).toThrow(DocxUsageError);
  });
  it("preserves JSON strings and validates nested unknown fields", () => {
    expect(parse("create", "--content-json", String.raw`{"version":1,"blocks":[{"kind":"paragraph","text":"海岸 \"quoted\""}]}`, "--dry-run").options.content).toEqual({ version: 1, blocks: [{ kind: "paragraph", text: '海岸 "quoted"' }] });
    expect(() => parse("create", "--content-json", '{"version":1,"blocks":[],"extra":true}', "--dry-run")).toThrow();
  });
  it("distinguishes absent, empty, false and null values", () => {
    expect(parse("runs", "set", "file", "--paragraph", "1", "--run", "1", "--bold", "false", "--italic", "null", "--text=", "--dry-run").options).toMatchObject({ bold: false, italic: null, text: "" });
    expect(() => parse("runs", "set", "file", "--paragraph", "1", "--run", "1", "--dry-run")).toThrow();
    expect(() => validateDocxInvocation({ operation: "runs.set", inputs: ["file"], options: { paragraph: 1, run: 1, bold: "false", dryRun: true } })).toThrow();
    expect(validateDocxInvocation({ operation: "runs.set", inputs: ["file"], options: { paragraph: 1, run: 1, bold: false, italic: undefined, dryRun: true } }).options).not.toHaveProperty("italic");
    expect(parse("text", "file", "--scope", "headers").options.scope).toBe("headers");
    expect(parse("controls", "bind", "file", "--control", "1", "--binding", "title", "--value-json", '"Coastal"', "--dry-run").options.valueJson).toBe("Coastal");
    expect(parse("images", "set", "file", "--image", "1", "--rotation", "-12.5", "--dry-run").options.rotation).toBe(-12.5);
    expect(parse("paragraphs", "set", "file", "--paragraph", "1", "--line-spacing", "1.5", "--dry-run").options.lineSpacing).toBe(1.5);
    expect(parse("styles", "set", "file", "--name", "Coastal", "--base", "null", "--dry-run").options.base).toBe(null);
  });
  it("rejects malformed encodings without conflating byte arguments", () => {
    expect(() => parseDocxArguments([new Uint8Array([0xff])])).toThrow();
    expect(() => parseDocxArguments(argv("text", "a\0b"))).toThrow();
    expect(() => validateDocxInvocation({ operation: "text.get", inputs: new Array(1), options: {} })).toThrow(DocxUsageError);
  });
  it("validates every batch item without dynamic invocation", () => {
    expect(validateDocxBatch({ version: 1, operations: [] }).operations).toEqual([]);
    expect(() => validateDocxBatch({ version: 1, operations: new Array(1) })).toThrow(DocxUsageError);
    expect(parse("batch", "file", "--ops-json", '{"version":1,"operations":[]}').options).toEqual({ version: 1, operations: [] });
    expect(parse("batch", "file", "--ops-json", '{"version":1,"operations":[{"operation":"text.replace","arguments":{"find":"a","with":"b","all":true}}]}', "--dry-run").options.operations).toHaveLength(1);
    expect(() => validateDocxBatch({ version: 1, operations: [{ operation: "constructor", arguments: {} }] })).toThrow();
    expect(() => validateDocxBatch({ version: 1, operations: [{ operation: "text.replace", arguments: { find: "a", with: "b", all: true, output: "out" } }] })).toThrow();
    expect(() => validateDocxBatch({ version: 1, operations: [{ operation: "text.replace", arguments: { find: "a", with: "b", all: true, surprise: 1 } }] })).toThrow();
    const getParagraphs = { operation: "model.document.Document.paragraphs.get", arguments: {}, receiver: { resultHandle: "document" }, resultHandle: "paragraphs" };
    expect(validateDocxBatch({ version: 1, operations: [getParagraphs, { operation: "model.text.paragraph.Paragraph.text.get", arguments: {}, receiver: { resultHandle: "paragraphs", index: 0 } }] }).operations).toHaveLength(2);
    expect(() => validateDocxBatch({ version: 1, operations: [getParagraphs, { operation: "model.text.run.Run.text.get", arguments: {}, receiver: { resultHandle: "paragraphs", index: 0 } }] })).toThrow(DocxUsageError);
    expect(() => validateDocxBatch({ version: 1, operations: [getParagraphs, { operation: "model.text.paragraph.Paragraph.text.get", arguments: {}, receiver: { resultHandle: "paragraphs", key: "a" } }] })).toThrow(DocxUsageError);
    expect(() => validateDocxBatch({ version: 1, operations: [{ operation: "model.document.Document.add_paragraph.call", arguments: { style: { resultHandle: "future" } }, receiver: { resultHandle: "document" } }] })).toThrow(DocxUsageError);
  });
  it("never reads binary input or invokes the handler after usage failure", async () => {
    let reads = 0;
    let calls = 0;
    const errors: Uint8Array[] = [];
    const engine = createDocxCommandEngine({ async execute() { calls++; return { exitCode: 0 }; } });
    const result = await engine.execute({ args: argv("batch", "-", "--ops-file", "-", "--dry-run"), stdin: { async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array([0xff]); } }, stdout: { async write() { throw new Error("unexpected output"); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }, signal: new AbortController().signal });
    expect(result.exitCode).toBe(2);
    expect(reads).toBe(0);
    expect(calls).toBe(0);
    expect(errors.length).toBe(1);
  });
  it("validates file JSON before allowing document acquisition", async () => {
    const volume = Volume.fromJSON({ "/ops.json": '{"version":1,"operations":[{"operation":"text.replace","arguments":{"find":"a","with":"b","all":true,"unknown":1}}]}', "/report.docx": "untouched" });
    let calls = 0;
    const engine = createDocxCommandEngine({
      async readSource(source) { return Uint8Array.from(volume.readFileSync(source.path) as Uint8Array); },
      async execute() { calls++; return { exitCode: 0 }; }
    });
    const result = await engine.execute({ args: argv("batch", "/report.docx", "--ops-file", "/ops.json", "--dry-run"), stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal });
    expect(result.exitCode).toBe(2);
    expect(calls).toBe(0);
    expect(volume.readFileSync("/report.docx", "utf8")).toBe("untouched");
  });
  it("reserves and parses explicit JSON stdin once before literal dispatch", async () => {
    let reads = 0;
    let received: unknown;
    const engine = createDocxCommandEngine({ async execute(invocation) { received = invocation.options; return { exitCode: 0 }; } });
    const result = await engine.execute({ args: argv("batch", "report.docx", "--ops-file", "-"), stdin: { async *[Symbol.asyncIterator]() { reads++; yield new TextEncoder().encode('{"version":1,"operations":[]}'); } }, stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(reads).toBe(1);
    expect(received).toEqual({ version: 1, operations: [] });
  });
  it("uses the same named-limit array for CLI and SDK and applies it before JSON decoding", () => {
    const limit = [{ name: "xmlDepth", value: 2 }];
    expect(parse("text", "file", "--limit", "xmlDepth=2").options.limit).toEqual(limit);
    expect(validateDocxInvocation({ operation: "text.get", inputs: ["file"], options: { limit } }).options.limit).toEqual(limit);
    expect(() => parse("create", "--content-json", '{"version":1,"blocks":[{"kind":"paragraph","text":"a"}]}', "--limit", "xmlDepth=2", "--dry-run")).toThrow(ResourceLimitError);
    expect(() => parse("text", "file", "--limit", "unknown=1")).toThrow(DocxUsageError);
    expect(() => validateDocxInvocation({ operation: "create", inputs: [], options: { content: { version: 1, blocks: [{ kind: "paragraph", text: "a" }] }, dryRun: true, limit: [{ name: "xmlDepth", value: 2 }] } })).toThrow(ResourceLimitError);
    expect(() => parse("tables", "add", "file", "--rows", "2", "--cols", "2", "--limit", "tableCells=3", "--dry-run")).toThrow(ResourceLimitError);
  });
  it("returns bounded JSON usage errors and escapes terminal control characters", async () => {
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const engine = createDocxCommandEngine({ async execute() { throw new Error("unexpected dispatch"); } });
    const result = await engine.execute({ args: argv("create", "--json", "--content-json", '{"version":1,"blocks":[],"bad\\u001b":true}', "--dry-run"), stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout.push(bytes); } }, stderr: { async write(bytes) { stderr.push(bytes); } }, signal: new AbortController().signal });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(stdout[0]))).toMatchObject({ version: 1, operation: "create", ok: false, data: null, affected: 0, locations: [], errors: [{ code: "usage" }] });
    expect(stderr.map(bytes => new TextDecoder().decode(bytes)).join("")).not.toContain("\u001b");
  });
  it("reports JSON source failure as I/O without exposing source diagnostics", async () => {
    const diagnostics: string[] = [];
    const engine = createDocxCommandEngine({ async readSource() { throw new Error("sensitive source detail"); }, async execute() { throw new Error("unexpected dispatch"); } });
    const result = await engine.execute({ args: argv("batch", "report.docx", "--ops-file", "ops.json"), stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(new TextDecoder().decode(bytes)); } }, signal: new AbortController().signal });
    expect(result.exitCode).toBe(3);
    expect(diagnostics.join("")).not.toContain("sensitive");
  });
});
