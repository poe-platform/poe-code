import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {native} from '../native.js';
import type {JsonSchemaDocument,JsonSchemaDocumentOptions} from './schema-types.js';
interface CompileConfigSchemaOptions {entrypoints:readonly string[];document?:JsonSchemaDocumentOptions;}
export interface CompileConfigSchemaFromSourceTextsOptions extends CompileConfigSchemaOptions {files:Record<string,string>;}
function normalizeFilePath(filePath:string):string{return path.posix.normalize(filePath.replaceAll(path.win32.sep,path.posix.sep));}
function moduleCandidates(base:string):string[]{
 const extension=path.posix.extname(base);
 if(['.js','.mjs','.cjs'].includes(extension)){
  const stem=base.slice(0,-extension.length);return [stem+'.ts',stem+'.tsx',stem+'.mts',stem+'.cts',base];
 }
 if(extension!=='')return [base];
 return [base+'.ts',base+'.tsx',base+'/index.ts',base+'/index.tsx'];
}
function compile(options:CompileConfigSchemaOptions,read:(filePath:string)=>string|undefined):JsonSchemaDocument {
 const compiler=new native.NativeConfigSchemaCompiler(),pending=options.entrypoints.map(normalizeFilePath),visited=new Set<string>();
 for(let cursor=0;cursor<pending.length;cursor++){
  const filePath=pending[cursor];if(visited.has(filePath))continue;
  const text=read(filePath);if(text===undefined)throw new Error(`Unable to read schema compilation entrypoint or import: ${filePath}`);
  visited.add(filePath);
  for(const specifier of compiler.scan(filePath.startsWith('/')?filePath:'/'+filePath,text)){
   if(!specifier.startsWith('.'))continue;
   const base=normalizeFilePath(path.posix.resolve(path.posix.dirname(filePath),specifier));
   const resolved=moduleCandidates(base).find(candidate=>read(candidate)!==undefined);
   if(resolved!==undefined&&!visited.has(resolved))pending.push(resolved);
  }
 }
 const documentOptions=options.document;
 const result=compiler.finish();
 const {id,schema='https://json-schema.org/draft/2020-12/schema',...metadata}={id:'https://poe-code.dev/schemas/poe-code.schema.json',title:'poe-code config',description:'Schema for poe-code config files',...documentOptions};
 result.$schema=schema;
 for(const [key,value]of [['$id',id],['title',metadata.title],['description',metadata.description]] as const){
  if(value===undefined)delete result[key];else result[key]=value;
 }
 return result;
}
export function compileConfigSchemaFromEntrypoints(options:CompileConfigSchemaOptions):JsonSchemaDocument {
 return compile(options,filePath=>existsSync(filePath)?readFileSync(filePath,'utf8'):undefined);
}
export function compileConfigSchemaFromSourceTexts(options:CompileConfigSchemaFromSourceTextsOptions):JsonSchemaDocument {
 const files=new Map(Object.entries(options.files).map(([filePath,text])=>[normalizeFilePath(filePath),text]));
 return compile(options,filePath=>files.get(filePath));
}
