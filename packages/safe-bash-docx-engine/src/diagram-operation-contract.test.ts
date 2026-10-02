import { expect, it } from "vitest";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { validateDocxInvocation } from "./command.js";

it("admits only package-global diagram read options in all declared transports", () => {
  for (const transport of ["cli", "sdk", "batch"] as const) {
    expect(Object.keys(getDocxOperationSchema("diagrams.list", transport).properties ?? {})).toEqual(transport === "batch" ? [] : ["json", "limit"]);
  }
  for (const name of ["scope", "select", "paragraph", "run", "table", "cell", "image", "section", "comment", "note", "link", "control", "revision", "shape", "field", "bookmark", "output"]) {
    expect(() => validateDocxInvocation({ operation: "diagrams.list", inputs: ["input.docx"], options: { [name]: name === "scope" ? "body" : name === "cell" ? "1,1" : name === "output" ? "out.docx" : 1 } })).toThrow();
  }
});

it("publishes closed preserve-only diagram snapshots and honest help", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "diagrams.list" } })!.data as DocxSchemaData;
  expect(data.operations[0]).toMatchObject({ id: "diagrams.list", support: "read", featureIds: ["F38"] });
  const success = data.operations[0]!.result.oneOf![0]!, record = success.properties!.data!.properties!.items!.items!;
  if (!record) throw new Error("Diagram item schema must be an object");
  const details = record.properties!.details!, role = details.properties!.roles!.items!, observation = details.properties!.observations!.items!;
  if (!role || !observation) throw new Error("Diagram role and observation schemas must be objects");
  const binding = observation.properties!.bindings!.items!, issue = details.properties!.issues!.items!;
  if (!binding || !issue) throw new Error("Diagram binding and issue schemas must be objects");
  for (const schema of [success, record, details, role, observation, binding, issue]) expect(schema.additionalProperties).toBe(false);
  expect(record.properties!.support).toEqual({ const: "preserve" });
  expect(record.properties!.location!.properties!.kind).toEqual({ const: "part" });
  expect(success.properties!.affected).toEqual({ const: 0 });
  expect(binding.properties!.status).toMatchObject({ enum: expect.arrayContaining(["internal", "external", "missing-id", "wrong-resource-type", "opaque"]) });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "diagrams.list" } })!.human;
  expect(help.toLowerCase()).toContain("preserve"); expect(help).toContain("physical"); expect(help).toContain("unsupported"); expect(help).not.toContain("--scope");
});

it("allows existing precise diagnostic locations only in affected mutation failures", () => {
  for (const operation of ["xml.set", "paragraphs.set"]) {
    const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData;
    const failure = data.operations[0]!.result.oneOf![1]!;
    expect(failure.properties!.locations!.maxItems).toBeUndefined();
    const diagnostic = failure.properties!.errors!.items!;
    if (!diagnostic) throw new Error("Mutation diagnostic must be an object");
    expect(diagnostic.additionalProperties).toBe(false);
    expect(diagnostic.properties!.location).toEqual({ type: "string" });
    expect(diagnostic.required).toEqual(["code", "message"]);
  }
});
