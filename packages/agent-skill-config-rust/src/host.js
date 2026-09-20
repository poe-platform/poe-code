import * as fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
let gitDirRunner=cwd=>{try{return execFileSync('git',['rev-parse','--git-dir'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return undefined;}};
export function setGitDirRunnerForTest(runner){const previous=gitDirRunner;gitDirRunner=runner;return ()=>{gitDirRunner=previous;};}
export function files(run){
 const errors=[];
 const callback=(operation,args)=>{
  try{
   let value;
   switch(operation){
    case 'gitDir':value=gitDirRunner(args[0])??null;break;
    case 'pathFacts':{const resolved=path.resolve(args[0]);value={resolved,root:path.parse(resolved).root,separator:path.sep,absolute:path.isAbsolute(args[0])};break;}
    case 'resolve':value=path.resolve(...args);break;
    case 'join':value=path.join(...args);break;
    case 'dirname':value=path.dirname(args[0]);break;
    case 'directory':value=fs.statSync(args[0]).isDirectory();break;
    case 'symbolic':value=fs.lstatSync(args[0]).isSymbolicLink();break;
    case 'read':value=fs.readFileSync(args[0],'utf8');break;
    case 'mkdir':fs.mkdirSync(args[0],{recursive:true});value=null;break;
    case 'temporary':value=`${args[0]}.poe-code-${process.pid}-${randomUUID()}.tmp`;break;
    case 'write':fs.writeFileSync(args[0],args[1],{encoding:'utf8',flag:'wx'});value=null;break;
    case 'rename':fs.renameSync(...args);value=null;break;
    case 'remove':fs.rmSync(args[0],{force:true});value=null;break;
    default:throw new Error(`Unknown skill filesystem operation ${operation}`);
   }
   return JSON.stringify(value);
  }catch(error){return JSON.stringify({error:errors.push(error)-1,code:error!==null&&(typeof error==='object'||typeof error==='function')&&Object.hasOwn(error,'code')?error.code:undefined});}
 };
 const result=run(callback);
 if(result!==null&&typeof result==='object'){
  if(Object.hasOwn(result,'foreignError'))throw errors[result.foreignError];
  if(Object.hasOwn(result,'error'))throw new Error(result.error);
 }
 return result;
}
