export interface DataLayer {source:string;data:Record<string,unknown>}
export interface ParsedDocument {data:Record<string,unknown>;format:'markdown'|'yaml'|'json';extends:boolean|string;hasExtendsField:boolean}
export function parseDocument(content:string,filePath:string):ParsedDocument;
export function mergeLayers(layers:DataLayer[]):{data:Record<string,unknown>;sources:Record<string,string>};
