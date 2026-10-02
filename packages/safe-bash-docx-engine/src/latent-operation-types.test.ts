import { expect, expectTypeOf, it } from "vitest";
import type { DocxBatchArgumentMap, DocxOperationArgumentMap } from "./operation-types.js";
import { assertDocxFields, docxOperationSchemas, docxCommonOptions } from "./operation-schema.js";

type ReadOperation = "styles.latent.list" | "styles.latent.get" | "styles.latent.defaults.get";
type LatentOperation =
  | ReadOperation
  | "styles.latent.add"
  | "styles.latent.set"
  | "styles.latent.remove"
  | "styles.latent.defaults.set";
type PublicationOption = "output" | "inPlace" | "force" | "dryRun";

it("rejects read publication options in both the SDK types and runtime declarations", () => {
  expectTypeOf<
    Extract<keyof DocxOperationArgumentMap[ReadOperation], PublicationOption>
  >().toEqualTypeOf<never>();
  for (const id of [
    "styles.latent.list",
    "styles.latent.get",
    "styles.latent.defaults.get"
  ] as const) {
    const declaration = docxOperationSchemas[id];
    const fields = {
      ...Object.fromEntries(declaration.commonOptions.map((key) => [key, docxCommonOptions[key]!])),
      ...declaration.sdkFields
    };
    expect(() => assertDocxFields(fields, { output: "/out.docx" })).toThrow();
  }
});

it("keeps common invocation options out of latent batch argument types", () => {
  expectTypeOf<
    Extract<keyof DocxBatchArgumentMap[LatentOperation], PublicationOption | "json" | "limit">
  >().toEqualTypeOf<never>();
  expectTypeOf<DocxBatchArgumentMap["styles.latent.list"]>().toEqualTypeOf<
    Readonly<Record<string, never>>
  >();
  expectTypeOf<DocxBatchArgumentMap["styles.latent.defaults.get"]>().toEqualTypeOf<
    Readonly<Record<string, never>>
  >();
  for (const [id, declaration] of Object.entries(docxOperationSchemas).filter(([id]) =>
    id.startsWith("styles.latent.")
  )) {
    expect(() => assertDocxFields(declaration.batchFields!, { output: "/out.docx" }), id).toThrow();
  }
});
