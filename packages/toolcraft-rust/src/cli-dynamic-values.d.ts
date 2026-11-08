import type {AnySchema,ValidationIssue} from "toolcraft-schema-rust";
import type {CLIFieldValidationError} from "./cli-consume.js";
export declare function finalizeDynamicValue(schema:AnySchema,value:unknown,displayPath:string,errors:CLIFieldValidationError[]):unknown;
export declare function formatFieldValidationIssue(issue:ValidationIssue,displayPath:string):CLIFieldValidationError;
