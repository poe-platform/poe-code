export type ValueResolver<T>=T|((options:MutationOptions)=>T);
export interface MutationOptions{[key:string]:unknown;}
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
export interface MutationDetails{kind:string;label:string;targetPath?:string;}
export interface MutationOutcome{changed:boolean;effect:'none'|'mkdir'|'delete'|'chmod';detail:'create'|'update'|'delete'|'noop';}
export interface MutationObservers{
 onStart?(details:MutationDetails):void;
 onComplete?(details:MutationDetails,outcome:MutationOutcome):void;
 onError?(details:MutationDetails,error:unknown):void;
}
export interface MutationContext{
 fs:FileSystem;
 homeDir:string;
 dryRun?:boolean;
 observers?:MutationObservers;
 pathMapper?:{mapTargetDirectory(input:{targetDirectory:string}):string};
}
interface BaseMutation{label?:string;}
export interface EnsureDirectoryMutation extends BaseMutation{kind:'ensureDirectory';path:ValueResolver<string>;}
export interface RemoveDirectoryMutation extends BaseMutation{kind:'removeDirectory';path:ValueResolver<string>;force?:boolean;}
export interface RemoveFileMutation extends BaseMutation{kind:'removeFile';target:ValueResolver<string>;whenEmpty?:boolean;whenContentMatches?:RegExp;}
export interface ChmodMutation extends BaseMutation{kind:'chmod';target:ValueResolver<string>;mode:number;}
export type FileMutation=EnsureDirectoryMutation|RemoveDirectoryMutation|RemoveFileMutation|ChmodMutation;
export interface MutationResult{changed:boolean;effects:MutationOutcome[];}
/** Execute file mutations with platform operations supplied by the caller. */
export function runMutations(mutations:FileMutation[],context:MutationContext,options?:MutationOptions):Promise<MutationResult>;
