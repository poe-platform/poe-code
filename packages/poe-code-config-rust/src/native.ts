import type {ConfigDocument} from "./types.js";
import {createRequire} from "node:module";
interface ConfigNative {
 NativeConfigSchemaCompiler:new()=>{scan(path:string,text:string):string[];finish():import("./compile/schema-types.js").JsonSchemaDocument};
 configParseStored(text:string):ConfigDocument|null;
 configServiceFiles(values:string[]):string[];
 configServiceText(value:string):string|null;
 configServiceShape(value:string):boolean;
 configStatePolicy(operation:string,value:number,hook:Hook):boolean|[string,number][];
 configSafeJobId(id:string,absolute:boolean):boolean;
 configOwnedDocument(snapshot:Buffer,root:number,override:number,operation:string):{data:ConfigDocument;references:[(string|number)[],number][]};
 configNormalize(value:number,hook:Hook):number;
 configNormalizeScope(value:number,hook:Hook):number;
 configMerge(base:number,over:number,hook:Hook):number;
 configCoerce(type:string,tag:number,text:string,number:number,boolean:boolean):string|number|boolean|null;
}
type Hook=(operation:string,args:unknown[])=>string;
export const native=createRequire(import.meta.url)("./poe-code-config-rust.node") as ConfigNative;
