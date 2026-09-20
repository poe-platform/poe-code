import type {ConfigObject} from './index.js';
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
export interface MutationOutcome{changed:boolean;effect:'none'|'mkdir'|'delete'|'chmod'|'copy'|'write';detail:'create'|'update'|'delete'|'noop'|'backup'|'restore';}
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
export interface BackupMutation extends BaseMutation{kind:'backup';target:ValueResolver<string>;once?:boolean;}
export interface RestoreBackupMutation extends BaseMutation{kind:'restoreBackup';target:ValueResolver<string>;}
export type FileMutation=BackupMutation|RestoreBackupMutation|EnsureDirectoryMutation|RemoveDirectoryMutation|RemoveFileMutation|ChmodMutation;
export interface ConfigMergeMutation extends BaseMutation{kind:'configMerge';target:ValueResolver<string>;value:ValueResolver<ConfigObject>;format?:'json'|'toml'|'yaml';pruneByPrefix?:Record<string,string>;}
export interface ConfigPruneMutation extends BaseMutation{kind:'configPrune';target:ValueResolver<string>;shape:ValueResolver<ConfigObject>;format?:'json'|'toml'|'yaml';onlyIf?:(doc:ConfigObject,options:MutationOptions)=>boolean;}
export interface ConfigTransformMutation extends BaseMutation{kind:'configTransform';target:ValueResolver<string>;format?:'json'|'toml'|'yaml';transform:(doc:ConfigObject,options:MutationOptions)=>{content:ConfigObject|null;changed:boolean};}
export type ConfigMutation=ConfigMergeMutation|ConfigPruneMutation|ConfigTransformMutation;
export type Mutation=FileMutation|ConfigMutation;
export interface MutationResult{changed:boolean;effects:MutationOutcome[];}
/** Execute file and configuration mutations with platform operations supplied by the caller. */
export function runMutations(mutations:Mutation[],context:MutationContext,options?:MutationOptions):Promise<MutationResult>;

export const fileMutation:{
 ensureDirectory(options:Omit<EnsureDirectoryMutation,'kind'>):EnsureDirectoryMutation;
 remove(options:Omit<RemoveFileMutation,'kind'>):RemoveFileMutation;
 removeDirectory(options:Omit<RemoveDirectoryMutation,'kind'>):RemoveDirectoryMutation;
 chmod(options:Omit<ChmodMutation,'kind'>):ChmodMutation;
 backup(options:Omit<BackupMutation,'kind'>):BackupMutation;
 restoreBackup(options:Omit<RestoreBackupMutation,'kind'>):RestoreBackupMutation;
};

export const configMutation:{
 merge(options:Omit<ConfigMergeMutation,'kind'>):ConfigMergeMutation;
 prune(options:Omit<ConfigPruneMutation,'kind'>):ConfigPruneMutation;
 transform(options:Omit<ConfigTransformMutation,'kind'>):ConfigTransformMutation;
};
