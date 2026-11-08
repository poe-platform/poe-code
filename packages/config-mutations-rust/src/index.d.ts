export type ConfigValue=string|number|boolean|null|ConfigObject|ConfigValue[]|Date;
export interface ConfigObject{[key:string]:ConfigValue;}
export interface ConfigFormat{
 parse(content:string):ConfigObject;
 serialize(obj:ConfigObject):string;
 serializeUpdate?(content:string,current:ConfigObject,next:ConfigObject):string;
 merge(base:ConfigObject,patch:ConfigObject):ConfigObject;
 prune(obj:ConfigObject,shape:ConfigObject):{changed:boolean;result:ConfigObject};
}
export {configMutation,fileMutation,templateMutation,runMutations} from './execution.js';
export type {Mutation,MutationContext,MutationResult,MutationObservers,MutationDetails,MutationOutcome,FileSystem,TemplateLoader} from './execution.js';
import type {FileSystem} from './execution.js';
export interface PathMapper{mapTargetDirectory(input:{targetDirectory:string}):string;}
export type TemplateVariables=Record<string,string|number|boolean|string[]>;
export function renderTemplate(template:string,variables:TemplateVariables):string;
export function isConfigObject(value:unknown):value is ConfigObject;
export function isNotFound(error:unknown):boolean;
export function readFileIfExists(fs:FileSystem,target:string):Promise<string|null>;
export function pathExists(fs:FileSystem,target:string):Promise<boolean>;
export function createTimestamp():string;
