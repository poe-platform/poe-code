import { expect, it } from "vitest";
import { Volume } from "memfs";
import { assertDocxFields, docxOperationSchemas, getDocxOperationSchema } from "./index.js";

it.each([
  "model.styles.style.BaseStyle.priority.set",
  "model.styles.style.CharacterStyle.priority.set",
  "model.styles.style.ParagraphStyle.priority.set",
  "model.styles.style._TableStyle.priority.set",
  "model.styles.style._NumberingStyle.priority.set",
  "model.styles.latent.LatentStyles.default_priority.set",
  "model.styles.latent._LatentStyle.priority.set"
])("declares checked nullable priority for %s", (operation) => {
  const volume = Volume.fromJSON({
    "/valid.json": JSON.stringify([null, 0, 24, 36, Number.MAX_SAFE_INTEGER]),
    "/invalid.json": JSON.stringify([-4, 0.5, "2", Number.MAX_SAFE_INTEGER + 1])
  });
  const schema = docxOperationSchemas[operation]!;
  for (const fields of [schema.fields, schema.sdkFields, schema.batchFields!]) {
    expect(fields.value!.type).toBe("nonnegative safe integer | null");
    for (const value of JSON.parse(volume.readFileSync("/valid.json", "utf8") as string))
      expect(() => assertDocxFields(fields, { value })).not.toThrow();
    for (const value of JSON.parse(volume.readFileSync("/invalid.json", "utf8") as string))
      expect(() => assertDocxFields(fields, { value })).toThrow();
  }
  expect(JSON.stringify(getDocxOperationSchema(operation))).toContain('"integer"');
});

it("declares checked positive revision across all input surfaces", () => {
  const volume = Volume.fromJSON({
    "/valid.json": JSON.stringify([1, 24, 42, Number.MAX_SAFE_INTEGER]),
    "/invalid.json": JSON.stringify([null, 0, -4, 0.5, "2", Number.MAX_SAFE_INTEGER + 1])
  });
  const operation = "model.opc.coreprops.CoreProperties.revision.set",
    schema = docxOperationSchemas[operation]!;
  for (const fields of [schema.fields, schema.sdkFields, schema.batchFields!]) {
    expect(fields.value!.type).toBe("positive integer");
    for (const value of JSON.parse(volume.readFileSync("/valid.json", "utf8") as string))
      expect(() => assertDocxFields(fields, { value })).not.toThrow();
    for (const value of JSON.parse(volume.readFileSync("/invalid.json", "utf8") as string))
      expect(() => assertDocxFields(fields, { value })).toThrow();
  }
  expect(JSON.stringify(getDocxOperationSchema(operation))).toContain('"integer"');
});
