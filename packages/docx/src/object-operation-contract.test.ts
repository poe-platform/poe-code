import { expect, it } from "vitest";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import { validateDocxInvocation } from "./command.js";

it("publishes closed inert object snapshots and exact part occurrence locations", () => {
  const discovery = getDocxDiscovery({
    operation: "schema",
    inputs: [],
    options: { operation: "objects.list" }
  })!;
  const operation = (discovery.data as DocxSchemaData).operations[0]!;
  expect(operation.support).toBe("read");
  expect(operation.featureIds).toEqual(["F40"]);
  const envelope = operation.result.oneOf![0]!,
    data = envelope.properties!.data!,
    record = data.properties!.items!.items!;
  if (!record) throw new Error("Object inventory must publish item schemas");
  const location = record.properties!.location!,
    details = record.properties!.details!;
  expect(location.properties!.kind).toEqual({ const: "part" });
  expect(location.properties!.value!.additionalProperties).toBe(false);
  expect(location.properties!.value!.properties!.path).toMatchObject({
    type: "array",
    items: { type: "integer", minimum: 0 }
  });
  for (const schema of [envelope, data, record, location, details, details.properties!.security!])
    expect(schema.additionalProperties).toBe(false);
  expect(details.properties!.security!.properties!.protected).toEqual({ const: "unknown" });
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!;
  expect(capabilities.data).toMatchObject({
    features: expect.arrayContaining([
      {
        id: "F40",
        level: "preserve",
        subsets: expect.arrayContaining([
          { name: "inert-object-inventory-extraction", level: "read", reason: expect.any(String) }
        ]),
        detected: null
      }
    ])
  });
});
it("rejects unknown and inapplicable object flags without acquiring input", () => {
  for (const options of [
    { output: "/other" },
    { outputDir: "/out" },
    { all: true },
    { unknown: true }
  ])
    expect(() =>
      validateDocxInvocation({ operation: "objects.list", inputs: ["document"], options })
    ).toThrow();
  expect(() =>
    validateDocxInvocation({
      operation: "objects.extract",
      inputs: ["document"],
      options: { outputDir: "/out", dryRun: true }
    })
  ).toThrow();
  expect(() =>
    validateDocxInvocation({
      operation: "objects.list",
      inputs: ["document"],
      options: { scope: "all-stories", limit: [{ name: "matches", value: 2 }] }
    })
  ).not.toThrow();
});
