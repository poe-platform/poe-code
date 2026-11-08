import { type Standardized } from "./standard.js";
import type { ObjectSchema, SchemaBase, Static } from "./index.js";
type UnionStatic<TBranches extends readonly ObjectSchema<any>[]> = Static<TBranches[number]>;
export interface UnionSchema<TBranches extends readonly ObjectSchema<any>[]> extends SchemaBase<
  "union",
  UnionStatic<TBranches>
> {
  readonly branches: TBranches;
}
export declare function getRequiredKeyFingerprint(schema: ObjectSchema<any>): string;
export declare function Union<const TBranches extends readonly ObjectSchema<any>[]>(
  branches: TBranches
): Standardized<UnionSchema<TBranches>>;
export {};
