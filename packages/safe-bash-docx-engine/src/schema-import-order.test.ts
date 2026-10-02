import { expect, it, vi } from "vitest";

it("initializes standalone operation schemas without loading a cyclic editor graph", async () => {
  vi.resetModules();
  const {getDocxOperationSchema} = await import("./operation-json-schema.js");
  expect(getDocxOperationSchema("images.replace", "sdk").properties?.image).toBeDefined();
  const {getDocxDiscovery} = await import("./discovery.js");
  const result = getDocxDiscovery({operation: "schema", inputs: [], options: {operation: "images.replace"}});
  expect(result?.data).toMatchObject({operations: [{support: "edit"}]});
});
