import { expect, it } from "vitest";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { validateDocxInvocation } from "./command.js";

it("admits only package-wide chart read options for direct and declared batch transports", () => {
  for (const transport of ["cli", "sdk", "batch"] as const) {
    const schema = getDocxOperationSchema("charts.list", transport);
    expect(Object.keys(schema.properties ?? {})).toEqual(transport === "batch" ? [] : ["json", "limit"]);
  }
  for (const name of ["scope", "select", "paragraph", "run", "table", "cell", "image", "section", "comment", "note", "link", "control", "revision", "shape", "field", "bookmark", "output"]) {
    expect(() => validateDocxInvocation({ operation: "charts.list", inputs: ["input.docx"], options: { [name]: name === "scope" ? "body" : name === "cell" ? "1,1" : name === "output" ? "out.docx" : 1 } })).toThrow();
  }
});

it("publishes read-only physical chart inventory with explicit pending execution profiles", () => {
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "charts.list" } })!.data;
  expect(schema).toMatchObject({ operations: [{ id: "charts.list", support: "read", featureIds: ["F37"], result: { oneOf: [{ properties: { affected: { const: 0 } } }, {}] } }] });
  const envelope = (schema as DocxSchemaData).operations[0]!.result.oneOf![0]!;
  const record = envelope.properties!.data!.properties!.items!.items!;
  if (!record) throw new Error("Chart item schema must be an object");
  expect(record.properties!.location!.properties!.kind).toEqual({ const: "part" });
  const details = record.properties!.details!, series = details.properties!.series!.items!;
  if (!series) throw new Error("Chart series schema must be an object");
  const source = series.properties!.sources!.items!;
  if (!source) throw new Error("Chart source schema must be an object");
  const cache = source.properties!.caches!.items!;
  if (!cache) throw new Error("Chart cache schema must be an object");
  const point = cache.properties!.points!.items!, binding = details.properties!.resources!.items!;
  if (!point || !binding) throw new Error("Chart point and binding schemas must be objects");
  for (const object of [envelope, record, details, series, source, cache, point, binding]) expect(object.additionalProperties).toBe(false);
  expect(point.properties!.index).toEqual({ oneOf: [{ type: "string" }, { type: "null" }] });
  expect(point.properties!.values!.items).toEqual(point.properties!.index);
  expect(cache.properties!.counts!.items).toEqual(point.properties!.index);
  expect(cache.properties!.freshness).toEqual({ enum: ["unknown", null] });
  expect(details.properties!.root!.properties).toHaveProperty("namespace");
  expect(binding.properties!.status).toMatchObject({ enum: expect.arrayContaining(["missing-id", "wrong-relationship-type", "external", "opaque"]) });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "charts.list" } })!.human;
  expect(help).toContain("physical"); expect(help).toContain("batch"); expect(help).toContain("unsupported");
});
