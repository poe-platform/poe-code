import { expect, it } from "vitest";
import { getDocxDiscovery } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { validateDocxInvocation } from "./command.js";

it("admits shape owner chains but closes unrelated resource selectors", () => {
  for (const operation of ["shapes.list", "shapes.set"] as const) {
    for (const transport of ["cli", "sdk", "batch"] as const) {
      const schema = getDocxOperationSchema(operation, transport);
      for (const name of ["image", "link", "control", "revision", "field", "bookmark"]) expect(schema.properties).not.toHaveProperty(name);
      for (const name of ["section", "table", "cell", "paragraph", "run", "shape"]) expect(schema.properties).toHaveProperty(name);
      expect(schema.properties).not.toHaveProperty("shared");
    }
  }
  expect(() => validateDocxInvocation({ operation: "shapes.set", inputs: ["input.docx"], options: { text: "New", dryRun: true } })).toThrow();
  expect(validateDocxInvocation({ operation: "shapes.set", inputs: ["input.docx"], options: { shape: 1, text: "", dryRun: true } }).operation).toBe("shapes.set");
});

it("advertises bounded shape inventory and setter without promoting geometry models", () => {
  for (const operation of ["shapes.list", "shapes.set"]) expect(getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data).toMatchObject({ operations: [{ id: operation, support: operation === "shapes.list" ? "read" : "edit", featureIds: ["F36"] }] });
  expect(getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F36", level: "edit" })]) });
});
