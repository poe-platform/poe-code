import type {AnySchema} from "toolcraft-schema-rust";
import type {Casing} from "./cli-policy.js";
import type {FieldSchema,DynamicFieldDefinition} from "./cli-fields.js";
export interface DynamicCLILeaf {displayPath:string;path:string[];schema:FieldSchema;}
export declare function resolveDynamicLeaf(schema:AnySchema,rawSegments:string[],casing:Casing,outputPath?:string[],displayPath?:string[],displayPathPrefix?:string):DynamicCLILeaf;
export declare function resolveDynamicOption(dynamicFields:DynamicFieldDefinition[],flagName:string,casing:Casing):{match:DynamicFieldDefinition;leaf:DynamicCLILeaf}|undefined;
export declare function isNumericFixtureSelector(value:string):boolean;
export declare function formatCliSchemaKind(kind:string):string;
export declare function formatUnsupportedDynamicSchemaMessage(kind:string,displayPath:string):string;
export declare function qualifyDisplayPath(prefix:string,displayPath:string):string;
