import type {Casing} from "./cli-policy.js";
import type {DynamicFieldDefinition} from "./cli-fields.js";
import type {CLIFieldValidationError} from "./cli-consume.js";
export declare function parseDynamicValues(dynamicFields:DynamicFieldDefinition[],rawArgv:string[],casing:Casing,errors:CLIFieldValidationError[]):{providedFieldIds:Set<string>;values:Map<string,unknown>;positionals:string[]};
export declare function setNestedValue(target:Record<string,unknown>,path:string[],value:unknown):void;
