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
  const fingerprints = new Map<string, { display: string; indices: number[] }>();

  branches.forEach((branch, index) => {
    const requiredKeys = getRequiredKeys(branch);
    const fingerprint = JSON.stringify(requiredKeys);
    const existing = fingerprints.get(fingerprint);

    if (existing === undefined) {
      fingerprints.set(fingerprint, {
        display: requiredKeys.join("+"),
        indices: [index],
      });
      return;
    }

    existing.indices.push(index);
  });

  for (const { display, indices } of fingerprints.values()) {
    if (indices.length > 1) {
      throw new Error(
        `Union branches [${indices.join(", ")}] share required-key fingerprint "${display}". Each branch must require a distinct set of keys.`
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
