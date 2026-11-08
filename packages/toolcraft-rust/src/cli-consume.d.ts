import type {FieldDefinition,FieldSchema} from "./cli-fields.js";
export interface CLIFieldValidationError {path:string;message:string;}
export declare function parseFieldInputValue(value:string,schema:FieldSchema,label:string):unknown;
export declare function parseOptionFieldValue(field:FieldDefinition,value:unknown,errors:CLIFieldValidationError[]):{ok:true;value:unknown}|{ok:false};
export declare function consumeFieldValue(args:string[],index:number,schema:FieldSchema,label:string,inlineValue?:string):{nextIndex:number;value:unknown};
