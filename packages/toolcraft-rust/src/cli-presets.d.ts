import type {FieldDefinition,DynamicFieldDefinition,FieldSchema,ScalarSchema} from "./cli-fields.js";
export declare function loadPresetValues(fields:FieldDefinition[],dynamicFields:DynamicFieldDefinition[],presetPath:string):Promise<{fields:Record<string,unknown>;dynamic:Map<string,unknown>}>;
export declare function validatePresetFieldValue(value:unknown,field:FieldDefinition,presetPath:string):unknown;
export declare function validatePresetScalarValue(value:unknown,schema:ScalarSchema,fieldPath:string,presetPath:string):string|number|boolean|null;
export declare function describeExpectedPresetValue(schema:FieldSchema):string;
export declare function hasNestedField(fields:ReadonlyArray<{path:string[]}>,path:string[]):boolean;
