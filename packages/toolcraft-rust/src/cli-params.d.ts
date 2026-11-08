import type {CliMissingParameterContext} from "toolcraft-schema-rust";
import type {FieldDefinition,DynamicFieldDefinition,VariantDefinition} from "./cli-fields.js";
import type {CLIFieldValidationError} from "./cli-consume.js";
import type {Casing} from "./cli-policy.js";
import type {PromptStreams} from "./cli-prompts.js";
export declare function resolveParams(fields:FieldDefinition[],dynamicFields:DynamicFieldDefinition[],variants:VariantDefinition[],positionalValues:string[],optionValues:Record<string,unknown>,rawArgv:string[],casing:Casing,presetPath:string|undefined,shouldPrompt:boolean,missingParameterContext:CliMissingParameterContext|undefined,promptStreams:PromptStreams,parameterDefaults?:Readonly<Record<string,unknown>>):Promise<Record<string,unknown>>;
export declare function throwValidationErrors(errors:readonly CLIFieldValidationError[]):void;
