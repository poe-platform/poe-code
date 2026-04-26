import type { AnySchema, ObjectSchema, OptionalSchema, SchemaBase, Static } from "./index.js";

type UnionStatic<TBranches extends readonly ObjectSchema<any>[]> = Static<TBranches[number]>;

export interface UnionSchema<TBranches extends readonly ObjectSchema<any>[]>
  extends SchemaBase<"union", UnionStatic<TBranches>> {
  readonly branches: TBranches;
}

function isOptionalSchema(schema: AnySchema): schema is OptionalSchema<AnySchema> {
  return schema.kind === "optional";
}

function getRequiredKeyFingerprint(schema: ObjectSchema<any>): string {
  const requiredKeys = Object.keys(schema.shape)
    .filter((key) => !isOptionalSchema(schema.shape[key] as AnySchema))
    .sort();

  return JSON.stringify(requiredKeys);
}

function assertValidBranches(branches: readonly ObjectSchema<any>[]): void {
  if (branches.length === 0) {
    throw new Error("Union schema requires at least one branch");
  }

  const fingerprints = new Set<string>();

  for (const branch of branches) {
    const fingerprint = getRequiredKeyFingerprint(branch);

    if (fingerprints.has(fingerprint)) {
      throw new Error("Union schema branches must have unique required-key fingerprints");
    }

    fingerprints.add(fingerprint);
  }
}

export function Union<const TBranches extends readonly ObjectSchema<any>[]>(
  branches: TBranches
): UnionSchema<TBranches> {
  assertValidBranches(branches);

  return {
    kind: "union",
    branches,
  };
}
