import { expect, it } from "vitest";
import { assertDocxFields, docxOperationSchemas, validateDocxValue } from "./operation-schema.js";
import { docxValueSchema } from "./operation-json-schema.js";
import { validateDocxOptionRules } from "./command-option-rules.js";

const flags = [
  "allCaps",
  "complexScriptEnabled",
  "csBold",
  "csItalic",
  "doubleStrike",
  "emboss",
  "imprint",
  "math",
  "noProof",
  "outline",
  "shadow",
  "smallCaps",
  "snapToGrid",
  "specVanish",
  "webHidden"
];
it.each(flags)("admits all three values of %s in runs and inherited styles", (flag) => {
  for (const id of ["runs.set", "styles.add", "styles.set", "styles.defaults.set"]) {
    for (const value of [true, false, null]) {
      const required =
        id === "styles.add"
          ? { name: "Harbor", type: "paragraph" }
          : id === "styles.set"
            ? { name: "Harbor" }
            : {};
      for (const transport of ["fields", "sdkFields", "batchFields"] as const)
        expect(() =>
          assertDocxFields(docxOperationSchemas[id]![transport]!, { ...required, [flag]: value })
        ).not.toThrow();
    }
  }
});
it("distinguishes style visibility from inherited font visibility and exposes paragraph fields", () => {
  expect(() =>
    assertDocxFields(docxOperationSchemas["styles.set"]!.sdkFields, {
      name: "Harbor",
      hidden: true,
      fontHidden: null,
      priority: null,
      unhideWhenUsed: false,
      keepTogether: null,
      rightIndent: { value: 1, unit: "cm" }
    })
  ).not.toThrow();
});
it("declares named latent reads and bounded nullable entries", () => {
  for (const action of ["list", "get", "add", "set", "remove", "defaults.get", "defaults.set"])
    expect(docxOperationSchemas[`styles.latent.${action}`]).toBeDefined();
  for (const value of [0, 99, null])
    expect(() =>
      assertDocxFields(docxOperationSchemas["styles.latent.set"]!.sdkFields, {
        name: "Harbor",
        priority: value,
        hidden: null
      })
    ).not.toThrow();
  for (const value of [-1, 100, 1.5])
    expect(validateDocxValue("integer 0..99 | null", value)).toBe(false);
  expect(docxValueSchema("integer 0..99")).toMatchObject({
    type: "integer",
    minimum: 0,
    maximum: 99
  });
  expect(() =>
    assertDocxFields(docxOperationSchemas["styles.latent.defaults.set"]!.sdkFields, {
      defaultToHidden: false,
      defaultPriority: 99,
      loadCount: 0
    })
  ).not.toThrow();
});
it("admits tab insertion and negative indexed deletion but rejects competing edits", () => {
  const fields = docxOperationSchemas["paragraphs.set"]!.sdkFields;
  expect(() =>
    assertDocxFields(fields, { tabStopAdd: { position: { value: 1, unit: "in" } } })
  ).not.toThrow();
  expect(() => assertDocxFields(fields, { tabStopDelete: -1 })).not.toThrow();
  for (const options of [
    { tabStops: [], tabStopsClear: true },
    { tabStopAdd: { position: { value: 1, unit: "in" } }, tabStopDelete: 0 }
  ])
    expect(() => validateDocxOptionRules("paragraphs.set", options)).toThrow();
});

it("advertises closed latent results and implemented editing routes", async () => {
  const { getDocxDiscovery } = await import("./discovery.js");
  const { parseDocxArguments } = await import("./command.js");
  const result = getDocxDiscovery(
    parseDocxArguments(
      ["schema", "styles", "latent", "set"].map((word) => new TextEncoder().encode(word))
    )
  );
  expect(result?.data).toMatchObject({
    operations: expect.arrayContaining([
      expect.objectContaining({ id: "styles.latent.set", support: "edit" })
    ])
  });
  const { inspectionOperationMetadata } = await import("./discovery-result-schema.js");
  expect(
    inspectionOperationMetadata["styles.latent.get"]?.result.oneOf?.[0]?.properties?.data
      ?.properties?.latent
  ).toBeDefined();
});
it("admits inherited resets of style presentation metadata and latent numeric defaults", () => {
  for (const key of ["hidden", "locked", "quickStyle", "unhideWhenUsed"])
    expect(() =>
      assertDocxFields(docxOperationSchemas["styles.set"]!.sdkFields, {
        name: "Harbor",
        [key]: null
      })
    ).not.toThrow();
  expect(() =>
    assertDocxFields(docxOperationSchemas["styles.latent.defaults.set"]!.sdkFields, {
      defaultPriority: null,
      loadCount: null
    })
  ).not.toThrow();
});
it("advertises supported style model batches without claiming unrelated model operations", async () => {
  const { getDocxDiscovery } = await import("./discovery.js");
  const supported = getDocxDiscovery({
    operation: "schema",
    inputs: [],
    options: { operation: "model.text.run.Font.bold.set" }
  })?.data;
  expect(supported).toMatchObject({
    operations: [{ id: "model.text.run.Font.bold.set", support: "edit" }]
  });
  const picture = getDocxDiscovery({
    operation: "schema",
    inputs: [],
    options: { operation: "model.document.Document.add_picture.call" }
  })?.data;
  expect(picture).toMatchObject({ operations: [{ support: "edit" }] });
  const unsupported = getDocxDiscovery({
    operation: "schema",
    inputs: [],
    options: { operation: "model.document.Document.save.call" }
  })?.data;
  expect(unsupported).toMatchObject({ operations: [{ support: "reject" }] });
});
it("retains nullable style names and IDs in inherited model declarations", () => {
  for (const type of [
    "BaseStyle",
    "CharacterStyle",
    "ParagraphStyle",
    "_TableStyle",
    "_NumberingStyle"
  ])
    for (const field of ["name", "style_id"]) {
      const prefix = `model.styles.style.${type}.${field}`;
      expect(() =>
        assertDocxFields(docxOperationSchemas[prefix + ".set"]!.sdkFields, { value: null })
      ).not.toThrow();
      expect(docxOperationSchemas[prefix + ".get"]?.valueType).toBe("string | null");
    }
});
it("lists only declared supported model batch operation IDs", async () => {
  const { styleModelBatchOperations } = await import("./style-model-batch-operations.js");
  expect(styleModelBatchOperations.filter((id) => !docxOperationSchemas[id])).toEqual([]);
});
it("admits canonical symbols for documented formatting enum aliases", () => {
  expect(
    validateDocxValue("MSO_THEME_COLOR_INDEX", { enum: "MSO_THEME_COLOR", name: "ACCENT_1" })
  ).toBe(true);
  expect(
    validateDocxValue("WD_ALIGN_PARAGRAPH", { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" })
  ).toBe(true);
});
