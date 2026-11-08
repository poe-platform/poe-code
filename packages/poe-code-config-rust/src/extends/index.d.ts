export interface DataLayer {
  source: string;
  data: Record<string, unknown>;
}

export interface DocumentLayer {
  source: string;
  filePath: string;
  content: string;
  baseName?: string;
}

export interface BaseLayer {
  source: string;
  path: string;
}

export type ChainLayer = DataLayer | DocumentLayer | BaseLayer;

export interface FileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
}

export interface ResolveOptions {
  fs: FileSystem;
  autoExtend?: boolean;
  validate?: boolean;
  view?: Record<string, unknown>;
}

export interface ResolvedDocument {
  data: Record<string, unknown>;
  sources: Record<string, string>;
  chain: string[];
}

export interface ParsedDocument {
  data: Record<string, unknown>;
  format: "markdown" | "yaml" | "json";
  extends: boolean | string;
  hasExtendsField: boolean;
}

export interface DiscoveredBase {content:string;filePath:string}
export interface PromptDocumentFileSystem {readFile(filePath:string,encoding:BufferEncoding):Promise<string>;realpath(filePath:string):Promise<string>}
export interface PromptDocumentBaseDocument {filePath:string;content:string}
export interface ResolvePromptDocumentInput {cwd:string;filePath:string;content?:string;optional?:boolean;basePaths?:readonly string[];baseDocuments?:readonly PromptDocumentBaseDocument[];variables?:Record<string,unknown>;validate?:boolean;fs?:PromptDocumentFileSystem}
export interface ResolvedPromptDocument {template:string;prompt:string;metadata:Record<string,unknown>;sources:Record<string,string>;source:string;chain:string[]}
export function parseDocument(content:string,filePath:string):ParsedDocument;
export function mergeLayers(layers:DataLayer[]):{data:Record<string,unknown>;sources:Record<string,string>};
export function findBase(name:string,bases:string[],fs:FileSystem):Promise<DiscoveredBase>;
export function resolve(chain:ChainLayer[],options:ResolveOptions):Promise<ResolvedDocument>;
export function resolvePromptDocument(input:ResolvePromptDocumentInput):Promise<ResolvedPromptDocument>;
