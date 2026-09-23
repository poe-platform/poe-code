import { expect, expectTypeOf, it } from "vitest";
import { getDocxDiscovery, type DocxCapabilitiesData, type DocxSchemaData } from "./discovery.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { styleModelBatchActions } from "./style-model-batch-operations.js";
import { structureModelBatchActions } from "./structure-model-batch-operations.js";
import { imageBatchActions } from "./image-batch-operations.js";

import type { DocxOperationId } from "./operation-schema.js";
import type { DocxOperationArgumentMap } from "./operation-types.js";

const schema = () =>
  getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!.data as DocxSchemaData;

it("publishes every declared operation with valid feature joins", () => {
  const operations = schema().operations;
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!
    .data as DocxCapabilitiesData;
  expect(operations.map(operation => operation.id).sort()).toEqual(
    Object.keys(docxOperationSchemas).sort()
  );
  const features = new Set(capabilities.features.map(feature => feature.id));
  expect(features.size).toBe(capabilities.features.length);
  for (const operation of operations) {
    expect(operation.featureIds.length, operation.id).toBeGreaterThan(0);
    expect(new Set(operation.featureIds).size, operation.id).toBe(operation.featureIds.length);
    for (const feature of operation.featureIds) expect(features.has(feature), operation.id).toBe(true);
    expect(operation.featureIds, operation.id).toEqual(
      Reflect.get(docxOperationSchemas[operation.id]!, "featureIds")
    );
  }
  for (const feature of capabilities.features) {
    const operationIds = operations
      .filter(operation => operation.featureIds.includes(feature.id))
      .map(operation => operation.id);
    expect(operationIds.length, feature.id).toBeGreaterThan(0);
    expect(Reflect.get(feature, "operationIds"), feature.id).toEqual(operationIds);
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
