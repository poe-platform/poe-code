import type {HelpToken} from "./design.js";
import type {Casing} from "./cli-policy.js";
import type {FieldDefinition,FieldSchema,DynamicFieldDefinition} from "./cli-fields.js";
export interface HelpOptionRow {description:string;flags:string;flagTokens:HelpToken[];}
export declare function formatHelpFieldFlags(field:FieldDefinition,globalLongOptionFlags:ReadonlySet<string>):string;
export declare function formatHelpFieldDescription(field:FieldDefinition):string;
export declare function formatCommandParameterFieldFlags(field:FieldDefinition,globalLongOptionFlags:ReadonlySet<string>):string;
export declare function formatDynamicHelpFields(field:DynamicFieldDefinition,casing:Casing):HelpOptionRow[];
export declare function describeDynamicFieldType(field:DynamicFieldDefinition):string;
export declare function formatCLIEnumChoices(schema:Extract<FieldSchema,{kind:"enum"}>):string[];
export declare function formatJsonHelpSchemaType(schema:FieldSchema):string;
export declare function tokenizeHelpFlags(flags:string):HelpToken[];
