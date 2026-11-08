import path from "node:path";
import {native} from "./native.js";
import {assertContainedPath} from "./path-boundary.js";
export function resolveWorkflowPath(inputPath:string,cwd:string,homeDir:string):string {
 if(inputPath.startsWith("~/"))return path.join(homeDir,inputPath.slice(2));
 if(inputPath==="~")return homeDir;
 return path.isAbsolute(inputPath)?inputPath:path.resolve(cwd,inputPath);
}
export interface DiscoverDocsOptions {
 cwd:string;homeDir:string;subDirectory:string;glob?:string;
 fs:{lstat:(path:string)=>Promise<{isSymbolicLink():boolean}>;readdir:(path:string)=>Promise<string[]>};
}
function missing(error:unknown):boolean {
 return typeof error==="object"&&error!==null&&Object.prototype.hasOwnProperty.call(error,"code")&&
  ((error as {code?:unknown}).code==="ENOENT"||(error as {code?:unknown}).code==="ENOTDIR");
}
async function discover(fs:DiscoverDocsOptions["fs"],directory:string,glob:string):Promise<{name:string;path:string}[]> {
 let entries:string[];
 try {
  if((await fs.lstat(directory)).isSymbolicLink())return [];
  entries=await fs.readdir(directory);
 }catch(error){if(missing(error))return [];throw error;}
 const docs:{name:string;path:string}[]=[];
 for(const name of entries){
  const suffix=glob.startsWith("*.");
  if(!native.harnessMatchesGlob(name,suffix?name.toLowerCase():name,glob,suffix?glob.toLowerCase():glob))continue;
  const absolute=path.join(directory,name);
  try {if(!(await fs.lstat(absolute)).isSymbolicLink())docs.push({name,path:absolute});}
  catch(error){if(!missing(error))throw error;}
 }
 return docs;
}
export async function discoverWorkflowDocs(options:DiscoverDocsOptions):Promise<string[]> {
 const glob=options.glob??native.harnessDefaultGlob(options.subDirectory);
 const projectRoot=path.join(options.cwd,".poe-code"),globalRoot=path.join(options.homeDir,".poe-code");
 const projectDirectory=path.join(projectRoot,options.subDirectory),globalDirectory=path.join(globalRoot,options.subDirectory);
 assertContainedPath(projectRoot,projectDirectory,"Workflow subdirectory must remain within the state root");
 assertContainedPath(globalRoot,globalDirectory,"Workflow subdirectory must remain within the state root");
 const [project,global]=await Promise.all([discover(options.fs,projectDirectory,glob),discover(options.fs,globalDirectory,glob)]);
 return native.harnessMergeDocs(global.map(doc=>doc.name),global.map(doc=>doc.path),project.map(doc=>doc.name),project.map(doc=>doc.path))
  .sort((left,right)=>left.localeCompare(right));
}
