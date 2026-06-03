import type { ObjectSchema, SchemaBase, Static } from "./index.js";

type OneOfStatic<
  TBranches extends Record<string, ObjectSchema<any>>,
  TDiscriminator extends string,
> = {
  [TBranchName in keyof TBranches & string]: Omit<Static<TBranches[TBranchName]>, TDiscriminator> & {
    [TFieldName in TDiscriminator]: TBranchName;
  };
}[keyof TBranches & string];

export interface OneOfSchema<
  TBranches extends Record<string, ObjectSchema<any>>,
  TDiscriminator extends string = string,
> extends SchemaBase<"oneOf", OneOfStatic<TBranches, TDiscriminator>> {
  readonly discriminator: TDiscriminator;
  readonly branches: TBranches;
}

function assertValidBranches(
  branches: Record<string, ObjectSchema<any>>,
  discriminator: string
): void {
  if (Object.keys(branches).length === 0) {
    throw new Error("OneOf schema requires at least one branch");
  }

  for (const [branchName, branch] of Object.entries(branches)) {
    if (Object.prototype.hasOwnProperty.call(branch.shape, discriminator)) {
      throw new Error(
        `OneOf branch "${branchName}" must not declare discriminator field "${discriminator}".`
      );
    }
  }
}

export function OneOf<
  TDiscriminator extends string,
  TBranches extends Record<string, ObjectSchema<any>>,
>(config: {
  discriminator: TDiscriminator;
  branches: TBranches;
}): OneOfSchema<TBranches, TDiscriminator> {
  assertValidBranches(config.branches, config.discriminator);

  return {
    kind: "oneOf",
    discriminator: config.discriminator,
    branches: config.branches,
  };
}
