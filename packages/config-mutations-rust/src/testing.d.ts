import type {FileSystem,ConfigObject} from './index.js';
export interface MockFileSystem extends FileSystem{
 files:Record<string,string>;
 directories:Set<string>;
 exists(path:string):boolean;
 getContent(path:string):string|undefined;
 readFile(path:string,encoding:'utf8'):Promise<string>;
 readFile(path:string):Promise<Uint8Array>;
}
export function createMockFs(initialFiles?:Record<string,string>,homeDir?:string):MockFileSystem;
export function parseJson(content:string):ConfigObject;
export function serializeJson(value:ConfigObject):string;
export function parseToml(content:string):ConfigObject;
export function serializeToml(value:ConfigObject):string;
export function parseYaml(content:string):ConfigObject;
export function serializeYaml(value:ConfigObject):string;
