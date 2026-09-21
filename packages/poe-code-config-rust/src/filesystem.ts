import {hasOwnErrorCode} from "./errors.js";
export interface FileSystem{
 readFile(path:string,encoding:'utf8'):Promise<string>;
 writeFile(path:string,content:string,options?:{encoding:'utf8';flag?:string}):Promise<void>;
 mkdir(path:string,options?:{recursive:boolean}):Promise<void>;
 rename(oldPath:string,newPath:string):Promise<void>;
 unlink(path:string):Promise<void>;
 rm?(path:string,options?:{recursive?:boolean;force?:boolean}):Promise<void>;
 stat(path:string):Promise<{mode?:number}>;
 lstat(path:string):Promise<{isSymbolicLink():boolean}>;
 readdir(path:string):Promise<string[]>;
 chmod?(path:string,mode:number):Promise<void>;
}
export function isNotFound(error: unknown): boolean { return hasOwnErrorCode(error,"ENOENT"); }
export function createTimestamp(): string {
 return new Date().toISOString().replaceAll(":","-").replaceAll(".","-");
}
export async function readFileIfExists(fs:FileSystem,target:string):Promise<string|null> {
 try{return await fs.readFile(target,"utf8");}catch(error){if(isNotFound(error))return null;throw error;}
}
export async function pathExists(fs:FileSystem,target:string):Promise<boolean> {
 try{await fs.stat(target);return true;}catch(error){if(isNotFound(error))return false;throw error;}
}
