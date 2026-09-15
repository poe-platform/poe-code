import { expect, it } from "vitest";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { validateDocxInvocation, validateDocxBatch } from "./command.js";
import { encodeLocation } from "./location-token.js";

it("closes physical equation read and explicit fragment transports", () => {
  for (const transport of ["cli", "sdk", "batch"] as const) {
    expect(Object.keys(getDocxOperationSchema("equations.list", transport).properties ?? {})).toEqual(transport === "batch" ? [] : ["json", "limit"]);
    for (const operation of ["equations.add", "equations.replace"]) {
      const schema = getDocxOperationSchema(operation, transport);
      expect(schema.required).toEqual(expect.arrayContaining(["file", "select"]));
      expect(schema.properties).not.toHaveProperty("scope");
      expect(schema.properties).not.toHaveProperty("paragraph");
      expect(schema.properties).not.toHaveProperty("all");
    }
  }
  for (const name of ["scope", "paragraph", "run", "all"]) {
    expect(() => validateDocxInvocation({ operation: "equations.list", inputs: ["input.docx"], options: { [name]: name === "scope" ? "body" : 1 } })).toThrow();
  }
});

it("requires explicit file and whole selection in SDK and batch admission", () => {
  const select = encodeLocation({ version: 1, sourceSha256: "a".repeat(64), generation: 0, part: "/word/document.xml", story: "body", path: [0, 0], range: null });
  const file = { kind: "bytes", base64: "AA==" };
  for (const operation of ["equations.add", "equations.replace"]) {
    for (const options of [{ file }, { select }, { select, file: "fragment.xml" }, { select, file, paragraph: 1 }, { select, file, scope: "body" }]) {
      expect(() => validateDocxInvocation({ operation, inputs: ["input.docx"], options })).toThrow();
      expect(() => validateDocxBatch({ version: 1, operations: [{ operation, arguments: options }] })).toThrow();
    }
    expect(validateDocxInvocation({ operation, inputs: ["input.docx"], options: { select, file, dryRun: true } })).toMatchObject({ options: { select, file } });
    expect(validateDocxBatch({ version: 1, operations: [{ operation, arguments: { select, file } }] })).toMatchObject({ operations: [{ arguments: { select, file } }] });
  }
});

it("publishes closed physical math and stored property result schemas", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "equations.list" } })!.data as DocxSchemaData;
  expect(data.operations[0]).toMatchObject({ support: "read", featureIds: ["F39"] });
  const success = data.operations[0]!.result.oneOf![0]!;
  const list = success.properties!.data!, record = list.properties!.items!.items!;
  if (!record) throw new Error("Equation record schema missing");
  const details = record.properties!.details!, property = list.properties!.globalProperties!.items!;
  if (!property) throw new Error("Equation property schema missing");
  for (const schema of [list, record, details, property]) expect(schema.additionalProperties).toBe(false);
  expect(details.properties!.active).toEqual({ type: "boolean" });
  expect(details.properties!.mathPaths).toHaveProperty("items");
  expect(property.properties!.status).toEqual({ enum: ["stored", "opaque"] });
  expect(record.properties!.location!.properties!.value!.properties!.path!.maxItems).toBeUndefined();
  for (const operation of ["equations.add", "equations.replace"]) {
    const result = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData;
    expect(result.operations[0]).toMatchObject({ support: "edit", featureIds: ["F39"] });
    const error = result.operations[0]!.result.oneOf![1]!.properties!.errors!.items;
    if (!error) throw new Error("Equation error schema missing");
    expect(error.properties).toHaveProperty("location");
  }
});
