import type { AnySchema, ObjectSchema, OptionalSchema, SchemaBase, Static } from "./index.js";

type UnionStatic<TBranches extends readonly ObjectSchema<any>[]> = Static<TBranches[number]>;

export interface UnionSchema<TBranches extends readonly ObjectSchema<any>[]>
  extends SchemaBase<"union", UnionStatic<TBranches>> {
  readonly branches: TBranches;
}

function isOptionalSchema(schema: AnySchema): schema is OptionalSchema<AnySchema> {
  return schema.kind === "optional";
}

function getRequiredKeys(schema: ObjectSchema<any>): string[] {
  return Object.keys(schema.shape)
    .filter((key) => !isOptionalSchema(schema.shape[key] as AnySchema))
    .sort();
}

export function getRequiredKeyFingerprint(schema: ObjectSchema<any>): string {
  return getRequiredKeys(schema).join("+");
}

function assertUniqueRequiredKeyFingerprints(branches: readonly ObjectSchema<any>[]): void {
  const fingerprints = new Map<string, number[]>();

  branches.forEach((branch, index) => {
    const fingerprint = getRequiredKeyFingerprint(branch);
    const indices = fingerprints.get(fingerprint) ?? [];
    indices.push(index);
    fingerprints.set(fingerprint, indices);
  });

  for (const [fingerprint, indices] of fingerprints) {
    if (indices.length > 1) {
      throw new Error(
        `Union branches [${indices.join(", ")}] share required-key fingerprint "${fingerprint}". Each branch must require a distinct set of keys.`
      );
    }
  }
}

function assertValidBranches(branches: readonly ObjectSchema<any>[]): void {
  if (branches.length === 0) {
    throw new Error("Union schema requires at least one branch");
  }

  assertUniqueRequiredKeyFingerprints(branches);
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
