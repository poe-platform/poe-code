import { expect, expectTypeOf, it } from "vitest";
import { validateDocxInvocation } from "./command.js";
import { getDocxDiscovery, type DocxSchemaData, type DocxCapabilitiesData } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import type { DocxOperationArgumentMap, DocxBatchArgumentMap } from "./operation-types.js";
import { encodeLocation } from "./location-token.js";

const decide = (operation: string, options: Record<string, unknown>) => validateDocxInvocation({ operation, inputs: ["input"], options: { dryRun: true, ...options } });

it("uses explicit revision selection or scoped all without ambient review metadata", () => {
  for (const operation of ["revisions.accept", "revisions.reject"]) {
    expect(() => decide(operation, { revision: 1 })).not.toThrow();
    expect(() => decide(operation, { all: true, scope: "body", allowEmpty: true })).not.toThrow();
    for (const options of [{}, { paragraph: 1 }, { all: true, revision: 1 }, { all: true, paragraph: 1 }, { revision: 1, author: "A" }, { revision: 1, timestamp: "2026-01-02T03:04:05Z" }]) {
      expect(() => decide(operation, options)).toThrow();
    }
  }
});

it("does not treat a text range token as a revision decision selector", () => {
  const select = encodeLocation({ version: 1, sourceSha256: "b".repeat(64), generation: 0, part: "/word/document.xml", story: "body", path: [0, 0], range: { start: 1, end: 2 } });
  for (const operation of ["revisions.accept", "revisions.reject"]) expect(() => decide(operation, { select })).toThrow();
});

it("advertises only bounded direct revision decisions and an operation report", () => {
  for (const operation of ["revisions.accept", "revisions.reject"]) {
    const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData;
    expect(schema.operations).toMatchObject([{ id: operation, support: "edit", featureIds: ["F26"], result: { oneOf: [
      { properties: { ok: { const: true }, affected: { type: "integer", minimum: 0 }, data: { properties: { changes: { type: "array" } } } } },
      { properties: { ok: { const: false }, data: { type: "null" } } },
    ] } }]);
    const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation } })!.human;
    expect(help).toContain("--revision");
    expect(help).toContain("--all");
    expect(help).toContain("ordered batches remain unsupported");
  }
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data as DocxCapabilitiesData;
  expect(capabilities.features.find(item => item.id === "F26")!.subsets).toContainEqual(expect.objectContaining({ name: "revision-decisions", level: "edit" }));
});


it("requires explicit decision selection in public TypeScript arguments", () => {
  // @ts-expect-error A decision cannot silently select a revision.
  const absent: DocxOperationArgumentMap["revisions.accept"] = {};
  // @ts-expect-error All conflicts with a targeted revision ordinal.
  const conflict: DocxBatchArgumentMap["revisions.reject"] = { all: true, revision: 1 };
  expectTypeOf(absent).toMatchTypeOf<DocxOperationArgumentMap["revisions.accept"]>();
  expectTypeOf(conflict).toMatchTypeOf<DocxBatchArgumentMap["revisions.reject"]>();
});

it("encodes explicit selection alternatives in every generated input schema", () => {
  for (const operation of ["revisions.accept", "revisions.reject"]) {
    for (const transport of ["cli", "sdk", "batch"] as const) {
      expect(getDocxOperationSchema(operation, transport).allOf).toEqual(expect.arrayContaining([
        expect.objectContaining({ anyOf: expect.arrayContaining([
          expect.objectContaining({ required: ["revision"] }),
          expect.objectContaining({ required: ["select"] }),
          expect.objectContaining({ required: ["all"], properties: { all: { const: true } } }),
        ]) }),
      ]));
    }
  }
});


it("describes bounded decisions consistently in revision creation help", () => {
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "revisions.add" } })!.human;
  expect(help).not.toContain("Acceptance/rejection, live owners and batches remain unsupported.");
  expect(help).not.toContain("Acceptance/rejection, live review owners and ordered batches remain unsupported.");
  expect(help).toContain("Acceptance/rejection is a separate bounded subset");
  expect(help).toContain("live review owners and ordered batches remain unsupported");
});
