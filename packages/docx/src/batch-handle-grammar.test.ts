import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, vi } from "vitest";
import { createDocxInspectionCommandEngine, validateDocxBatch } from "./index.js";
import { docxValueSchema } from "./operation-json-schema.js";
import { textContext } from "../tests/fixtures/text.js";

const operation = "model.document.Document.paragraphs.get";
const root = { id: "document", type: "DocumentModel", owner: "document", revision: 0 };
const items = docxValueSchema("BatchV1").properties!.operations!.items;
if (!items) throw new Error("Batch schema requires item declarations.");
const validate = new Ajv2020({ strict: false }).compile(
  items.oneOf!.find((entry) => entry.properties!.operation!.const === operation)!
);

it.each(["entry\n", "entry\r\n", "entry\r"])(
  "rejects a trailing line terminator in the operation ID %j",
  (id) => {
    const item = { id, operation, arguments: {}, receiver: root };
    expect(() => validateDocxBatch({ version: 1, operations: [item] })).toThrow();
    expect(validate(item), JSON.stringify(validate.errors)).toBe(false);
  }
);

it.each(["A", "log", "log_2", "Log9", "x".repeat(100)])(
  "admits the result name %j through both schema and batch grammar",
  (resultHandle) => {
    const item = { operation, arguments: {}, receiver: root, resultHandle };
    expect(validate(item), JSON.stringify(validate.errors)).toBe(true);
    expect(validateDocxBatch({ version: 1, operations: [item] }).operations[0]).toEqual(item);
  }
);

it.each([
  "",
  "log-entry",
  "_log",
  "4log",
  "log entry",
  "équipe",
  "log\n",
  "log\r\n",
  "log\0",
  "log💡"
])(
  "rejects the result name %j in the schema and before CLI document acquisition",
  async (resultHandle) => {
    const item = { operation, arguments: {}, receiver: root, resultHandle };
    expect(validate(item), JSON.stringify(validate.errors)).toBe(false);
    const batch = { version: 1, operations: [item] };
    expect(() => validateDocxBatch(batch)).toThrow();
    const readFile = vi.fn(async () => new Uint8Array());
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["batch", "input.docx", "--ops-json", JSON.stringify(batch), "--json"].map((word) =>
        new TextEncoder().encode(word)
      ),
      cwd: "/work",
      signal: new AbortController().signal,
      filesystem: { readFile },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write() {} },
      stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(2);
    expect(readFile).not.toHaveBeenCalled();
  }
);

it.each([{ index: 0 }, { key: "title" }, { index: 0, key: "title" }])(
  "rejects collection selection on a direct receiver: %j",
  async (selection) => {
    const item = { operation, arguments: {}, receiver: { ...root, ...selection } };
    expect(validate(item), JSON.stringify(validate.errors)).toBe(false);
    const batch = { version: 1, operations: [item] };
    expect(() => validateDocxBatch(batch)).toThrow();
    const readFile = vi.fn(async () => new Uint8Array());
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["batch", "input.docx", "--ops-json", JSON.stringify(batch), "--json"].map((word) =>
        new TextEncoder().encode(word)
      ),
      cwd: "/work",
      signal: new AbortController().signal,
      filesystem: { readFile },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write() {} },
      stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(2);
    expect(readFile).not.toHaveBeenCalled();
  }
);
