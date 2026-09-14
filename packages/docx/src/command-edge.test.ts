import { expect, it } from "vitest";
import { DocxUsageError } from "./argument-json.js";
import { parseDocxArguments, validateDocxInvocation, validateDocxBatch } from "./command.js";

const parse = (...words: string[]) => parseDocxArguments(words.map(word => new TextEncoder().encode(word)));

it.each([
  ["runs", "set", "file", "--bold", "true", "--dry-run"],
  ["images", "get", "file"],
  ["paragraphs", "set", "file", "--text", "x", "--dry-run"],
  ["headers", "get", "file"],
  ["runs", "add", "file", "--text", "x", "--dry-run"]
])("requires resource or container selection before acquisition: %j", (...words) => {
  expect(() => parse(...words)).toThrow(DocxUsageError);
});

it("rejects sibling story selectors without treating them as an owner chain", () => {
  expect(() => parse("text", "file", "--section", "1", "--comment", "1")).toThrow(DocxUsageError);
});

it.each([
  ["create", "unexpected.docx", "--help"],
  ["text", "one.docx", "two.docx", "--help"],
  ["create", "--content-file", "content.json", "--content-json", '{"version":1,"blocks":[]}', "--help"],
  ["create", "--output", "out.docx", "--in-place", "--help"]
])("help waives required values but retains invalid supplied combinations: %j", (...words) => {
  expect(() => parse(...words)).toThrow(DocxUsageError);
});

it("rejects publication controls on a read-only batch", () => {
  expect(() => parse("batch", "file", "--ops-json", '{"version":1,"operations":[]}', "--output", "out.docx")).toThrow(DocxUsageError);
});

it("requires a typed model receiver and rejects a mismatching owner type", () => {
  for (const receiver of [undefined, { id: "one", type: "Paragraph", owner: "document", revision: 0 }]) {
    expect(() => validateDocxBatch({ version: 1, operations: [{
      operation: "model.comments.Comment.author.get", arguments: {}, receiver
    }] })).toThrow(DocxUsageError);
  }
});

it("rejects result handles bound to void-returning setters", () => {
  expect(() => validateDocxBatch({ version: 1, operations: [{
    operation: "model.comments.Comment.author.set", arguments: { value: "Robin" },
    receiver: { id: "one", type: "Comment", owner: "document", revision: 0 }, resultHandle: "written"
  }] })).toThrow(DocxUsageError);
});

it("prevents later caller mutation of validated nested content", () => {
  const paragraph = { kind: "paragraph", text: "before" };
  const validated = validateDocxInvocation({ operation: "create", inputs: [], options: {
    content: { version: 1, blocks: [paragraph] }, dryRun: true
  } });
  paragraph.text = "after";
  expect(validated.options.content).toEqual({ version: 1, blocks: [{ kind: "paragraph", text: "before" }] });
});

it("rejects malformed SDK Unicode paths with the same usage error as CLI input", () => {
  expect(() => validateDocxInvocation({ operation: "text.get", inputs: ["\ud800.docx"], options: {} })).toThrow(DocxUsageError);
});

it("accepts explicit physical line spacing and preserves literal null paragraph text", () => {
  expect(parse("paragraphs", "set", "file", "--paragraph", "1", "--line-spacing", "12pt", "--text", "null", "--dry-run").options)
    .toMatchObject({ lineSpacing: { value: 12, unit: "pt" }, text: "null" });
});


it.each([
  ["images", "get", "file", "--all"],
  ["tables", "rows", "add", "file", "--dry-run"],
  ["tables", "split", "file", "--table", "1", "--rows", "2", "--cols", "2", "--dry-run"],
  ["bookmarks", "add", "file", "--name", "Anchor", "--paragraph", "1", "--dry-run"],
  ["text", "file", "--table", "1", "--paragraph", "1"],
  ["sections", "set", "file", "--section", "1", "--paragraph", "1", "--columns", "2", "--dry-run"]
])("rejects inapplicable or incomplete selection chains: %j", (...words) => {
  expect(() => parse(...words)).toThrow(DocxUsageError);
});
