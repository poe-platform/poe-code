import type {ConfigObject,ConfigValue,ConfigFormat} from './index.js';
export declare function detectIndent(content:string):string;
export declare function modifyAtPath(content:string,path:(string|number)[],value:ConfigValue|undefined):string;
export declare function removeAtPath(content:string,path:(string|number)[]):string;
export declare function serializeUpdate(content:string,current:ConfigObject,next:ConfigObject):string;
export declare function mergePreservingComments(content:string,patch:ConfigObject):string;
export declare const jsonFormat:ConfigFormat;
