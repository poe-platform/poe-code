import { readFileSync } from "node:fs";
import { expect, expectTypeOf, it } from "vitest";
import { getDocxDiscovery, type DocxCapabilitiesData, type DocxSchemaData } from "./discovery.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { styleModelBatchActions } from "./style-model-batch-operations.js";
import { structureModelBatchActions } from "./structure-model-batch-operations.js";
import { imageBatchActions } from "./image-batch-operations.js";

import type { DocxOperationId } from "./operation-schema.js";
import type { DocxOperationArgumentMap } from "./operation-types.js";

const register = JSON.parse(
  readFileSync(new URL("../../../docs/docx/command-coverage.json", import.meta.url), "utf8")
) as {
  operations: Record<string, { featureIds: string[] }>;
  features: { id: string; operationIds: string[] }[];
  sdk: { id: string; operationIds: string[]; featureIds: string[] }[];
};
const api = JSON.parse(
  readFileSync(new URL("../../../docs/docx/public-api-map.json", import.meta.url), "utf8")
) as {
  rows: { id: string; feature_ids: string[] }[];
};
const schema = () =>
  getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!.data as DocxSchemaData;

it("documents every declared operation and every public API ID without orphan routes", () => {
  expect(Object.keys(register.operations).sort()).toEqual(Object.keys(docxOperationSchemas).sort());
  expect(register.sdk.map((row) => row.id).sort()).toEqual(api.rows.map((row) => row.id).sort());
  expect(
    register.sdk.flatMap((row) => row.operationIds.filter((id) => !docxOperationSchemas[id]))
  ).toEqual([]);
  expect(
    register.features.flatMap((row) => row.operationIds.filter((id) => !docxOperationSchemas[id]))
  ).toEqual([]);
});

it("retains every documented feature join on the same declaration used by schema and capabilities", () => {
  const operations = schema().operations;
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!
    .data as DocxCapabilitiesData;
  expect(capabilities.features.map((row) => row.id).sort()).toEqual(
    register.features.map((row) => row.id).sort()
  );
  const missing = register.features.flatMap((feature) =>
    feature.operationIds
      .filter(
        (id) =>
          !operations.find((operation) => operation.id === id)?.featureIds.includes(feature.id)
      )
      .map((id) => `${feature.id}:${id}`)
  );
  expect(missing).toEqual([]);
  for (const operation of operations) {
    expect(operation.featureIds.length, operation.id).toBeGreaterThan(0);
    expect(operation.featureIds, operation.id).toEqual(
      Reflect.get(docxOperationSchemas[operation.id]!, "featureIds")
    );
    expect([...operation.featureIds].sort(), operation.id).toEqual(
      [...register.operations[operation.id]!.featureIds].sort()
    );
  }
  for (const feature of capabilities.features) {
    expect(Reflect.get(feature, "operationIds"), feature.id).toEqual(
      operations
        .filter((operation) => operation.featureIds.includes(feature.id))
        .map((operation) => operation.id)
    );
  }
});

it("accounts for every executable model handler with a declared, supported typed route", () => {
  const operations = schema().operations;
  for (const id of new Set([
    ...styleModelBatchActions.keys(),
    ...structureModelBatchActions.keys(),
    ...imageBatchActions.keys()
  ])) {
    const operation = operations.find((row) => row.id === id);
    expect(operation, id).toBeDefined();
    expect(operation!.support, id).not.toBe("reject");
    expect(operation!.path, id).toEqual(["batch"]);
  }
});

it("derives operation IDs from declarations and joins the complete SDK argument surface", () => {
  expectTypeOf<keyof DocxOperationArgumentMap>().toEqualTypeOf<DocxOperationId>();
});

it("classifies core properties as document metadata instead of images", () => {
  const operations = schema().operations;
  for (const id of [
    "model.opc.coreprops.CoreProperties.title.set",
    "model.package.Package.core_properties.get"
  ]) {
    const operation = operations.find((row) => row.id === id)!;
    expect(operation.featureIds).toContain("F30");
    expect(operation.featureIds).not.toContain("F31");
  }
});

it.each(Object.entries(docxOperationSchemas))(
  "executes closed help/schema discovery for %s",
  async (id, declaration) => {
    const { createDocxInspectionCommandEngine } = await import("./index.js");
    const { textContext } = await import("../tests/fixtures/text.js");
    const target =
      declaration.transport === "typed-batch" ? ["batch", "--operation", id] : id.split(".");
    const engine = createDocxInspectionCommandEngine({ limits: textContext.limits });
    for (const command of ["help", "schema"]) {
      let stdout = "",
        stderr = "";
      const result = await engine.execute({
        args: [command, ...target, "--json"].map((word) => new TextEncoder().encode(word)),
        cwd: "/",
        signal: textContext.signal,
        filesystem: {
          async readFile() {
            throw new Error("Discovery must not acquire a document.");
          }
        },
        stdin: {
          [Symbol.asyncIterator]() {
            return {
              async next(): Promise<IteratorResult<Uint8Array>> {
                throw new Error("Discovery must not consume stdin.");
              }
            };
          }
        },
        stdout: {
          async write(bytes) {
            stdout += new TextDecoder().decode(bytes);
          }
        },
        stderr: {
          async write(bytes) {
            stderr += new TextDecoder().decode(bytes);
          }
        }
      });
      expect(result.exitCode, stderr).toBe(0);
      const resultData = JSON.parse(stdout).data;
      if (command === "help")
        expect(
          resultData.paths.flatMap((path: { operationIds: string[] }) => path.operationIds)
        ).toEqual([id]);
      else {
        expect(resultData.operations.map((operation: { id: string }) => operation.id)).toEqual([
          id
        ]);
        expect(resultData.operations[0].input.additionalProperties).toBe(false);
      }
    }
  }
);

it("keeps the current evidence snapshot joined to live declarations and every API row", async () => {
  const audit = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/docx/discovery-reconciliation-20260916/current-map.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as {
    operations: Record<
      string,
      {
        support: string;
        featureIds: string[];
        fields: unknown;
        sdkFields: unknown;
        batchFields: unknown;
      }
    >;
    apis: Record<string, { declaredOperationIds: string[]; cliCapabilityOperationIds: string[] }>;
    runtimeExports: string[];
  };
  const native = JSON.parse(readFileSync(new URL("../../../docs/docx/part-provider-protocol-20260917/discovery-map-update.json", import.meta.url), "utf8")) as {
    operations: typeof audit.operations; apis: typeof audit.apis; runtimeExports: string[];
    runtimeMembers: Record<string, { operationIds: string[]; members: { operationIds: string[]; evidenceKind: string }[] }>;
  };
  Object.assign(audit.operations, native.operations);
  Object.assign(audit.apis, native.apis);
  audit.runtimeExports = native.runtimeExports;
  expect(Object.keys(audit.operations).sort()).toEqual(Object.keys(docxOperationSchemas).sort());
  expect(Object.keys(audit.apis).sort()).toEqual(api.rows.map((row) => row.id).sort());
  expect(audit.runtimeExports).toEqual(Object.keys(await import("./index.js")).sort());
  for (const operation of schema().operations) {
    const declaration = docxOperationSchemas[operation.id]!;
    expect(audit.operations[operation.id], operation.id).toMatchObject({
      support: operation.support,
      featureIds: declaration.featureIds,
      fields: declaration.fields,
      sdkFields: declaration.sdkFields,
      batchFields: declaration.batchFields ?? null
    });
  }
  for (const [id, row] of Object.entries(audit.apis)) {
    expect(row.declaredOperationIds, id).toEqual(
      register.sdk.find((entry) => entry.id === id)!.operationIds
    );
    for (const operation of row.cliCapabilityOperationIds) {
      expect(audit.operations[operation], `${id}:${operation}`).toBeDefined();
      expect(audit.operations[operation]!.support, `${id}:${operation}`).not.toBe("reject");
    }
  }
  const runtimeAudit = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/docx/discovery-reconciliation-20260916/runtime-public-members.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as {
    exports: Record<
      string,
      { operationIds: string[]; members: { operationIds: string[]; evidenceKind: string }[] }
    >;
    unjoinedExports: string[];
  };
  Object.assign(runtimeAudit.exports, native.runtimeMembers);
  expect(Object.keys(runtimeAudit.exports).sort()).toEqual(audit.runtimeExports);
  expect(runtimeAudit.unjoinedExports).toEqual([]);
  for (const [name, entry] of Object.entries(runtimeAudit.exports)) {
    expect(entry.operationIds.length, name).toBeGreaterThan(0);
    for (const member of entry.members) {
      expect(member.evidenceKind).toBe("structural-mapping-not-behavior-pass");
      expect(member.operationIds.length, name).toBeGreaterThan(0);
      for (const id of member.operationIds)
        expect(docxOperationSchemas[id], `${name}:${id}`).toBeDefined();
    }
  }
});
