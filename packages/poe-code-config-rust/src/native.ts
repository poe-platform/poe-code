import {createRequire} from "node:module";
interface ConfigNative {
 configNormalize(value:number,hook:Hook):number;
 configNormalizeScope(value:number,hook:Hook):number;
 configMerge(base:number,over:number,hook:Hook):number;
 configCoerce(type:string,tag:number,text:string,number:number,boolean:boolean):string|number|boolean|null;
}
type Hook=(operation:string,args:unknown[])=>string;
export const native=createRequire(import.meta.url)("./poe-code-config-rust.node") as ConfigNative;
