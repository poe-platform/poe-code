import { type Standardized } from "./standard.js";
import type { ObjectSchema, SchemaBase, Static } from "./index.js";
type OneOfStatic<
  TBranches extends Record<string, ObjectSchema<any>>,
  TDiscriminator extends string
> = {
  [TBranchName in keyof TBranches & string]: Omit<
    Static<TBranches[TBranchName]>,
    TDiscriminator
  > & {
    [TFieldName in TDiscriminator]: TBranchName;
  };
}[keyof TBranches & string];
export interface OneOfSchema<
  TBranches extends Record<string, ObjectSchema<any>>,
  TDiscriminator extends string = string
> extends SchemaBase<"oneOf", OneOfStatic<TBranches, TDiscriminator>> {
  readonly discriminator: TDiscriminator;
  readonly branches: TBranches;
}
export declare function OneOf<
  TDiscriminator extends string,
  TBranches extends Record<string, ObjectSchema<any>>
>(config: {
  discriminator: TDiscriminator;
  branches: TBranches;
}): Standardized<OneOfSchema<TBranches, TDiscriminator>>;
export {};
