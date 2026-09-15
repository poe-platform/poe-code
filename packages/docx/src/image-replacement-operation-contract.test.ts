import { expect, it } from "vitest";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { getDocxDiscovery } from "./discovery.js";
import { parseDocxArguments } from "./command.js";

it("does not advertise image replacement selectors that admission never accepts", () => {
  for (const transport of ["cli", "sdk", "batch"] as const) {
    const schema = getDocxOperationSchema("images.replace", transport);
    for (const key of ["all", "link", "control", "revision", "shape", "field", "bookmark"]) expect(schema.properties?.[key]).toBeUndefined();
    for (const key of ["image", "paragraph", "run", "table", "cell", "section", "scope", "select", "shared"]) expect(schema.properties?.[key]).toBeDefined();
  }
  expect(() => parseDocxArguments(["images", "replace", "input.docx", "--file", "Map.PNG", "--all", "--dry-run"].map(value => new TextEncoder().encode(value)))).toThrow();
});
it("declares occurrence and explicitly shared replacement receipts without floating layout support", () => {
  expect(getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "images.replace" } })!.data).toMatchObject({ operations: [{ support: "edit", featureIds: ["F32", "F35"], result: { oneOf: [{ properties: { data: { properties: { changes: { items: { properties: { kind: { const: "replace" } } } } } } } }, {}] } }] });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "images.replace" } })!.human;
  for (const value of ["occurrence", "shared", "stream", "fallback", "preserve"]) expect(help).toContain(value);
});
it("scopes replacement capabilities to direct commands while shared-owner and batch models remain pending", () => {
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data;
  expect(capabilities).toMatchObject({ features: expect.arrayContaining([
    expect.objectContaining({ id: "F32", subsets: expect.arrayContaining([expect.objectContaining({ name: "raster-occurrence-replacement", level: "edit", reason: expect.stringContaining("Direct") })]) }),
    expect.objectContaining({ id: "F35", level: "edit", subsets: expect.arrayContaining([expect.objectContaining({ name: "explicit-shared-raster-replacement", level: "edit" })]) })
  ]) });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "images.replace" } })!.human;
  expect(help).toContain("batch execution remains unsupported");
});
