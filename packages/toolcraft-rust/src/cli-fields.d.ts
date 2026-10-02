import type {AnySchema,ArraySchema,ObjectSchema,RecordSchema,JsonValueSchema} from "toolcraft-schema-rust";
import type {Casing} from "./cli-policy.js";
export type ScalarSchema = Extract<AnySchema, {
    kind: "string" | "number" | "boolean" | "enum";
}>;
export type FieldSchema = ScalarSchema | ArraySchema<any> | JsonValueSchema;
export interface FieldDefinition {
    id: string;
    path: string[];
    displayPath: string;
    optionAttribute: string;
    commanderOptionAttribute: string;
    optionFlag: string;
    longAliases: string[];
    shortFlag?: string;
    schema: FieldSchema;
    description?: string;
    optional: boolean;
    hasDefault: boolean;
    defaultValue: unknown;
    requiredWhenActive: boolean;
    global?: boolean;
    synthetic?: boolean;
    variantId?: string;
    variantBranchId?: string;
    positionalIndex?: number;
    variadicPosition?: boolean;
}
export interface DynamicFieldDefinition {
    id: string;
    path: string[];
    displayPath: string;
    optionPath: string[];
    optionPathDisplay: string;
    optionFlag: string;
    description?: string;
    optional: boolean;
    hasDefault: boolean;
    defaultValue: unknown;
    requiredWhenActive: boolean;
    schema: RecordSchema<any> | ArraySchema<ObjectSchema<any>>;
    variantId?: string;
    variantBranchId?: string;
}
export interface VariantBranchDefinition {
    branchId: string;
    dynamicFieldIds: string[];
    fieldIds: string[];
    requiredDynamicFieldIds: string[];
    requiredFieldIds: string[];
}
export interface VariantDefinition {
    id: string;
    controlDisplayPath: string;
    controlFieldId: string;
    optional: boolean;
    parent?: {
        id: string;
        branchId: string;
    };
    branches: VariantBranchDefinition[];
}
export interface CollectedCliSchema {
    dynamicFields: DynamicFieldDefinition[];
    fields: FieldDefinition[];
    variants: VariantDefinition[];
}
export declare function collectFields(schema:ObjectSchema<any>,casing:Casing,globalLongOptionFlags:ReadonlySet<string>,path?:string[],inheritedOptional?:boolean,variantContext?:{branchId:string;id:string}):CollectedCliSchema;
export declare function assignPositionals(fields:FieldDefinition[],positional:string[]):FieldDefinition[];
export declare function validateUniqueOptionFlags(fields:FieldDefinition[],globalLongOptionFlags:ReadonlySet<string>):void;
export declare function formatOptionFlags(field:FieldDefinition,globalLongOptionFlags:ReadonlySet<string>):string;
