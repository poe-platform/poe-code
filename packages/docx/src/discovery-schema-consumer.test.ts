import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import { docxValueSchema } from "./operation-json-schema.js";
import { validateDocxBatch } from "./command.js";
import { applyStyleModelBatch } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

it("publishes valid draft 2020-12 input and result schemas for every declaration", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!
    .data as DocxSchemaData;
  for (const operation of data.operations) {
    for (const [kind, schema] of Object.entries({ input: operation.input, result: operation.result })) {
      expect(ajv.validateSchema(schema), `${operation.id} ${kind}: ${JSON.stringify(ajv.errors)}`)
        .toBe(true);
    }
  }
});

it.each(["harbour-note", "1harbour", "_harbour", "harbour note", "équipe", "harbour\n"])(
  "rejects invalid result handle %j in both generated schema and SDK admission",
  (resultHandle) => {
    const operation = "model.document.Document.paragraphs.get";
    const item = { operation, receiver: { resultHandle: "document" }, arguments: {}, resultHandle };
    expect(() => validateDocxBatch({ version: 1, operations: [item] })).toThrow();
    const batch = docxValueSchema("BatchV1");
    const branch = batch.properties!.operations!.items;
    if (!branch) throw new Error("Missing batch items");
    const schema = branch.oneOf!.find((entry) => entry.properties!.operation!.const === operation)!;
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(item), JSON.stringify(validate.errors)).toBe(false);
  }
);

it.each(["index", "key"])("rejects %s on a direct root receiver before execution", (field) => {
  const item = {
    operation: "model.document.Document.paragraphs.get",
    receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0,
      [field]: field === "index" ? 0 : "ignored" },
    arguments: {}
  };
  expect(() => validateDocxBatch({ version: 1, operations: [item] })).toThrow();
});

it("validates actual inherited, returned, helper and underscore model results", async () => {
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {} },
    { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "part" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: { resultHandle: "part" }, arguments: {}, resultHandle: "package" },
    { operation: "model.package.Package.parts.get", receiver: { resultHandle: "package" }, arguments: {} },
    { operation: "model.parts.document.DocumentPart.rels.get", receiver: { resultHandle: "part" }, arguments: {}, resultHandle: "relationships" },
    { operation: "model.opc.rel.Relationships.items.call", receiver: { resultHandle: "relationships" }, arguments: {} },
    { operation: "model.shared.RGBColor.call", arguments: { r: 12, g: 34, b: 56 }, resultHandle: "color" },
    { operation: "model.shared.RGBColor.__iter__.call", receiver: { resultHandle: "color" }, arguments: {} }
  ];
  const bytes = await textFixture(paragraph("Harbour log"));
  const applied = await applyStyleModelBatch(bytes, { version: 1, operations }, textContext);
  expect(applied.results[1]!.value).toBe("Harbour log");
  expect(applied.results.at(-1)!.value).toEqual([12, 34, 56]);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  for (const result of applied.operationResults) {
    const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: result.operation } })!.data as DocxSchemaData;
    const validate = ajv.compile(data.operations[0]!.result);
    expect(validate(result), `${result.operation}: ${JSON.stringify(validate.errors)}`).toBe(true);
  }
});

it("compiles every declared field type including recursive content and tuple receivers", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  for (const type of [
    "OriginalDocumentContentV1",
    "XmlNodeInput",
    "TemplateData",
    "Iterable<readonly [string, RelationshipView]>"
  ]) {
    expect(() => ajv.compile(docxValueSchema(type)), type).not.toThrow();
  }
});
