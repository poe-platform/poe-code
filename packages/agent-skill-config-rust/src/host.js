import * as fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
let gitDirRunner=cwd=>{try{return execFileSync('git',['rev-parse','--git-dir'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return undefined;}};
export function setGitDirRunnerForTest(runner){const previous=gitDirRunner;gitDirRunner=runner;return ()=>{gitDirRunner=previous;};}
function admittedCode(operation,error){
 let codes;
 switch(operation){
  case 'directory':codes=['ENOENT','ENOTDIR'];break;
  case 'exists':case 'bridgeDirectory':case 'symbolic':case 'read':codes=['ENOENT'];break;
  case 'write':codes=['EEXIST'];break;
  case 'rmdir':codes=['ENOENT','ENOTEMPTY','EEXIST'];break;
  default:return undefined;
 }
 if(!(error instanceof Error&&Object.hasOwn(error,'code')))return undefined;
 for(const code of codes)if(error.code===code)return code;
}
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
    case 'exists':fs.statSync(args[0]);value=true;break;
    case 'bridgeDirectory':value=fs.statSync(args[0]).isDirectory();break;
    case 'bridgeRelation':{const root=path.resolve(args[0]),target=path.resolve(args[1]),relative=path.relative(root,target);value={root,target,relative,absolute:path.isAbsolute(relative),separator:path.sep};break;}
    case 'kind':{const stats=fs.lstatSync(args[0]);value=stats.isSymbolicLink()?'link':stats.isDirectory()?'directory':stats.isFile()?'file':'other';break;}
    case 'names':value=fs.readdirSync(args[0]);break;
    case 'entries':value=fs.readdirSync(args[0],{withFileTypes:true}).map(entry=>({name:entry.name,kind:entry.isSymbolicLink()?'link':entry.isDirectory()?'directory':entry.isFile()?'file':'other'}));break;
    case 'copyFile':fs.copyFileSync(...args);value=null;break;
    case 'writeToken':fs.writeFileSync(args[0],args[1],'utf8');value=null;break;
    case 'uuid':value=randomUUID();break;
    case 'removeTree':fs.rmSync(args[0],{recursive:true,force:true});value=null;break;
    case 'rmdir':fs.rmdirSync(args[0]);value=null;break;
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
  }catch(error){let code;try{code=admittedCode(operation,error);}catch(classificationError){error=classificationError;}return JSON.stringify({error:errors.push(error)-1,code});}
 };
 const readBytes=path=>{try{return {content:fs.readFileSync(path)};}catch(error){return {error:errors.push(error)-1};}};
 const result=run(callback,readBytes);
 if(result!==null&&typeof result==='object'){
  if(Object.hasOwn(result,'foreignError'))throw errors[result.foreignError];
  if(Object.hasOwn(result,'error'))throw new Error(result.error);
  if(Object.hasOwn(result,'userError')){const error=new Error(result.userError);error.name='UserError';error.hint=undefined;throw error;}
 }
 return result;
}
