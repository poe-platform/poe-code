import path from 'node:path';
import {native} from './native.js';
import {jsonFormat} from './json.js';
import {tomlFormat} from './toml.js';
import {yamlFormat} from './yaml.js';
export const parseJson=jsonFormat.parse,serializeJson=jsonFormat.serialize,
 parseToml=tomlFormat.parse,serializeToml=tomlFormat.serialize,
 parseYaml=yamlFormat.parse,serializeYaml=yamlFormat.serialize;
function expandPath(input,home){if(input.startsWith('~/'))return path.join(home,input.slice(2));if(input==='~')return home;if(input.startsWith('~'))return path.join(home,input.slice(1));return input;}
function addDirectoryTree(target,directories){let current='/';const parts=native.configMockDirectoryParts(target,path.sep.charCodeAt(0));directories.add(current);for(const part of parts){current=path.join(current,part);directories.add(current);}}
/** Host-visible mutable state remains in memory; Rust owns filesystem admission. */
export function createMockFs(initialFiles,homeDir='/home/test'){
 const files={},directories=new Set();
 if(initialFiles)for(const [input,content]of Object.entries(initialFiles)){const absolute=expandPath(input,homeDir);files[absolute]=content;addDirectoryTree(path.dirname(absolute),directories);}
 addDirectoryTree(homeDir,directories);
 function admission(operation,absolute,options){
  const machine=new native.ConfigMockMachine(operation,absolute);let request=machine.start();
  try{while(true){
   if(request.error)throw Error(request.error);
   if(request.kind==='failure'){const error=Error(request.message);error.code=request.code;throw error;}
   if(request.kind==='done')return request;
   let flag;
   switch(request.kind){
    case 'exclusive':flag=options?.flag==='wx';break;
    case 'recursive':flag=!!options?.recursive;break;
    case 'file':flag=absolute in files;break;
    case 'directory':flag=directories.has(absolute);break;
    case 'parent':{const parent=path.dirname(absolute);flag=operation==='mkdir'&&parent===absolute||directories.has(parent);break;}
    default:throw Error(`Unknown mock filesystem request: ${request.kind}`);
   }
   request=machine.respond(flag);
  }}finally{machine.discard();}
 }
 return {
  files,directories,
  exists(input){return admission('exists',expandPath(input,homeDir)).exists;},
  getContent(input){return files[expandPath(input,homeDir)];},
  async readFile(input,encoding){const absolute=expandPath(input,homeDir);admission('readFile',absolute);const content=files[absolute];return encoding?content:Buffer.from(content,'utf8');},
  async writeFile(input,content,options){const absolute=expandPath(input,homeDir);admission('writeFile',absolute,options);files[absolute]=typeof content==='string'?content:Buffer.isBuffer(content)?content.toString('utf8'):Buffer.from(content.buffer,content.byteOffset,content.byteLength).toString('utf8');},
  async mkdir(input,options){const absolute=expandPath(input,homeDir),plan=admission('mkdir',absolute,options);if(plan.recursive)addDirectoryTree(absolute,directories);else directories.add(absolute);},
  async unlink(input){const absolute=expandPath(input,homeDir);admission('unlink',absolute);delete files[absolute];},
  async rename(from,to){const absolute=expandPath(from,homeDir),next=expandPath(to,homeDir);admission('rename',absolute);files[next]=files[absolute];delete files[absolute];},
  async stat(input){return {mode:admission('stat',expandPath(input,homeDir)).mode};},
  async lstat(input){admission('lstat',expandPath(input,homeDir));return {isSymbolicLink:()=>false};},
  async readdir(input){const absolute=expandPath(input,homeDir);admission('readdir',absolute);const entries=new Set();for(const file of Object.keys(files))if(path.dirname(file)===absolute)entries.add(path.basename(file));for(const directory of directories)if(directory!==absolute&&path.dirname(directory)===absolute)entries.add(path.basename(directory));return Array.from(entries);},
  async chmod(input,mode){void mode;admission('chmod',expandPath(input,homeDir));},
 };
}
