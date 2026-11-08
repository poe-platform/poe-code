export type FrontmatterBlock={raw:string;body:string;rawStart:number;rawEnd:number;};
export type SplitFrontmatterResult=FrontmatterBlock|{body:string};
export function splitFrontmatterBlock(source:string):SplitFrontmatterResult;
export interface ParsedFrontmatter{frontmatter:Record<string,unknown>;body:string;}
export interface SourceLineCounter{lineStarts:number[];addNewLine:(offset:number)=>number;linePos:(offset:number)=>{line:number;col:number};}
export interface ParsedFrontmatterDocument extends ParsedFrontmatter{errors:readonly {message:string;pos?:[number,number]}[];lineCounter:SourceLineCounter;}
export interface ParseFrontmatterOptions{uniqueKeys?:boolean;}
export class FrontmatterParseError extends Error{constructor(message:string);}
export class FrontmatterKindError extends FrontmatterParseError{readonly expectedKind:string;readonly foundKind:string;constructor(message:string,kinds:{expected:string;found:string});}
export function isFrontmatterKindError(error:unknown):error is FrontmatterKindError;
export function parseFrontmatter(source:string,options?:ParseFrontmatterOptions):ParsedFrontmatter;
export function parseFrontmatterDocument(source:string,options?:ParseFrontmatterOptions):ParsedFrontmatterDocument;
export function stringifyFrontmatter(frontmatter:Record<string,unknown>,body:string):string;
