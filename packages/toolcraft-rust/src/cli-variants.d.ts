import type {FieldDefinition,DynamicFieldDefinition,VariantDefinition} from "./cli-fields.js";
import type {CLIFieldValidationError} from "./cli-consume.js";
import type {PromptStreams} from "./cli-prompts.js";
export declare function enforceVariantConstraints(params:Record<string,unknown>,fields:FieldDefinition[],dynamicFields:DynamicFieldDefinition[],variants:VariantDefinition[],resolvedFieldValues:Map<string,unknown>,providedDynamicFieldIds:Set<string>,providedFieldIds:Set<string>,shouldPrompt:boolean,errors:CLIFieldValidationError[],promptStreams:PromptStreams):Promise<void>;
export declare function getNestedValue(target:Record<string,unknown>,path:string[]):unknown;
