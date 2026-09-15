import { expect, it } from "vitest";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";

const parse = (...flags: string[]) => parseDocxArguments(["images", "add", "input.docx", "--file", "image.png", "--output", "output.docx", ...flags].map(value => new TextEncoder().encode(value)));
it("admits explicit decorative insertion intent equally in closed CLI and SDK declarations", () => {
  for (const transport of ["cli", "sdk", "batch"] as const) {
    const schema = getDocxOperationSchema("images.add", transport);
    expect(schema.properties?.decorative).toEqual({ type: "boolean" });
    expect(schema.properties?.all).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
  }
  for (const value of ["true", "false"]) expect(parse("--decorative", value).options.decorative).toBe(value === "true");
  expect(() => validateDocxInvocation({ operation: "images.add", inputs: ["input"], options: { file: { kind: "bytes", base64: "AA==" }, output: "output", decorative: true } })).not.toThrow();
});
it("rejects image-add all selection and decorative text conflicts before input acquisition", () => {
  expect(() => parse("--all")).toThrow();
  expect(() => parse("--decorative", "true", "--alt", "Island")).toThrow();
  expect(() => parse("--decorative", "true", "--alt", "")).not.toThrow();
  expect(() => parse("--decorative", "false", "--alt", "Island")).not.toThrow();
});
it("retains explicit physical units and refuses implicit pixel insertion sizing", () => {
  for (const width of ["1in", "2.5cm", "3mm", "12pt", "914400emu"]) expect(() => parse("--width", width)).not.toThrow();
  for (const width of ["96", "96px", "0emu", "-1in"]) expect(() => parse("--width", width)).toThrow();
});
it("advertises only the independently qualified inline PNG and JPEG insertion subset", () => {
  expect(getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "images.add" } })!.data).toMatchObject({ operations: [{ support: "edit", featureIds: ["F06", "F08", "F11", "F12", "F31", "F32", "F35"] }] });
  expect(getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!.data).toMatchObject({ operations: expect.arrayContaining([expect.objectContaining({ id: "images.add", support: "edit" })]) });
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data;
  expect(capabilities).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F32", level: "edit", detected: null, subsets: [expect.objectContaining({ name: "inline-png-jpeg-insertion", level: "edit" })] })]) });
  for (const operation of ["images.replace", "images.set", "model.image.image.Image.from_blob.call"]) {
    expect(getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data).toMatchObject({ operations: [{ support: "reject" }] });
  }
});
it("declares original inline insertion receipts and honest native-sizing help", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "images.add" } })!.data as DocxSchemaData;
  expect(data.operations[0]!.result.oneOf?.[0]?.properties).toMatchObject({ data: { additionalProperties: false, properties: { changes: { items: { properties: { kind: { const: "add" } } } } } } });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "images.add" } })!.human;
  for (const text of ["PNG", "JPEG", "72", "decorative", "paragraph", "no", "fallback", "physical"]) expect(help).toContain(text);
});
it("admits explicit empty-selection success while bounding insertion receipts to one owner", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "images.add" } })!.data as DocxSchemaData;
  const success = data.operations[0]!.result.oneOf?.[0];
  expect(success?.properties?.affected).toEqual({ enum: [0, 1] });
  expect(success?.properties?.data?.properties?.changes).toMatchObject({ type: "array", minItems: 0, maxItems: 1 });
  expect(success?.properties?.locations).toMatchObject({ type: "array", minItems: 0, maxItems: 1 });
});
it("omits selectors that can never target an image insertion owner from schema and help", () => {
  const invalid = ["run", "image", "link", "control", "revision", "shape", "field", "bookmark"];
  for (const transport of ["cli", "sdk", "batch"] as const) for (const key of invalid) expect(getDocxOperationSchema("images.add", transport).properties?.[key]).toBeUndefined();
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "images.add" } })!.human;
  for (const key of invalid) expect(help).not.toContain("--" + key + " ");
  for (const key of ["paragraph", "table", "cell", "section", "note", "scope", "select"]) expect(help).toContain("--" + key + " ");
});
