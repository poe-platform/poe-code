import path from "node:path";
import {createHash} from "node:crypto";
import {mkdir,realpath} from "node:fs/promises";
import {native} from "./native.js";
import {assertContainedPath} from "./path-boundary.js";
export interface ResolveRunLogDirOptions {planPath:string;runner:string;homeDir:string;}
export interface RunLogFileSystem {mkdir(path:string,options?:{recursive?:boolean}):Promise<void>;realpath?(path:string):Promise<string>;}
export function slugifyPlanPath(planPath:string):string {
 const base=path.basename(planPath);
 const normalized=path.normalize(path.isAbsolute(planPath)?planPath:path.resolve(planPath));
 const digest=createHash("sha256").update(normalized).digest("hex").slice(0,12);
 return native.harnessPlanSlug(base,digest);
}
export function makeRunLogFileName(role:string,date:Date=new Date()):string {
 const parts=[`${date.getUTCFullYear()}`,`${date.getUTCMonth()+1}`,`${date.getUTCDate()}`,`${date.getUTCHours()}`,`${date.getUTCMinutes()}`,`${date.getUTCSeconds()}`,`${date.getUTCMilliseconds()}`];
 return native.harnessLogFilename(role,parts);
}
export function resolveRunLogDir(options:ResolveRunLogDirOptions):string {
 const slug=slugifyPlanPath(options.planPath),root=path.join(options.homeDir,".poe-code","logs"),directory=path.join(root,options.runner,slug);
 assertContainedPath(root,directory,"Runner must remain within the log root");
 return directory;
}
const defaultFs:RunLogFileSystem={async mkdir(target,options){await mkdir(target,options);},realpath};
async function existingContained(fs:RunLogFileSystem,stateDir:string,candidate:string,ignoreMissing=false):Promise<boolean>{
 try {
  const resolveRealpath=fs.realpath??(async(target:string)=>path.resolve(target));
  const [state,target]=await Promise.all([resolveRealpath(stateDir),resolveRealpath(candidate)]);
  assertContainedPath(state,target,"Runner log directory resolves outside the poe-code state directory");return true;
 }catch(error){
  if(ignoreMissing&&typeof error==="object"&&error!==null&&Object.prototype.hasOwnProperty.call(error,"code")&&(error as {code?:unknown}).code==="ENOENT")return false;
  throw error;
 }
}
export async function ensureSafeRunLogDir(options:ResolveRunLogDirOptions&{fs?:RunLogFileSystem}):Promise<string>{
 const state=path.join(options.homeDir,".poe-code"),root=path.join(state,"logs"),directory=resolveRunLogDir(options),fs=options.fs??defaultFs;
 await fs.mkdir(state,{recursive:true});await fs.mkdir(root,{recursive:true});
 await existingContained(fs,state,root);
 const segments=path.relative(root,directory).split(path.sep).filter(Boolean);
 let current=root;
 for(const segment of segments){current=path.join(current,segment);if(!(await existingContained(fs,state,current,true)))break;}
 await fs.mkdir(directory,{recursive:true});await existingContained(fs,state,directory);
 return directory;
}
