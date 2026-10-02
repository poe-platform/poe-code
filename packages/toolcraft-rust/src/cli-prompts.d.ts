import type {FieldDefinition,FieldSchema} from "./cli-fields.js";
export interface PromptStreams {input?:NodeJS.ReadableStream;output?:NodeJS.WritableStream;}
export declare function promptForField(field:FieldDefinition,streams?:PromptStreams):Promise<unknown>;
export declare function formatResolvedValue(value:unknown):string;
export declare function fieldPromptLabel(field:FieldDefinition):string;
export declare function enumOptionLabel(schema:Extract<FieldSchema,{kind:"enum"}>,value:unknown):string;
export declare function withPromptStreams<T extends object>(options:T,streams:PromptStreams):T&PromptStreams;
export declare function throwPromptCancellation():never;
