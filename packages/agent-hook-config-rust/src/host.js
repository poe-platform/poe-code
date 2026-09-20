import * as fs from 'node:fs';
import path from 'node:path';
import {Snapshot} from './snapshot.js';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
let gitDirRunner=cwd=>{try{return execFileSync('git',['rev-parse','--git-dir'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return undefined;}};
export function setGitDirRunnerForTest(runner){const previous=gitDirRunner;gitDirRunner=runner;return ()=>{gitDirRunner=previous;};}
export function admit(value){
 const snapshot=new Snapshot(),active=new Set();let nodes=0;
 function write(value,depth){
  if(depth>128||++nodes>262144)throw new RangeError('Hook metadata exceeds transfer limits');
  if(value===null){snapshot.tag(0);return;}
  if(value===undefined){snapshot.tag(1);return;}
  if(typeof value==='boolean'){snapshot.tag(value?3:2);return;}
  if(typeof value==='number'){snapshot.tag(4);snapshot.number(value);return;}
  if(typeof value==='string'){snapshot.tag(5);snapshot.text(value);return;}
  if(typeof value!=='object')throw new TypeError('Unsupported hook metadata value');
  if(active.has(value))throw new TypeError('Cyclic hook metadata');active.add(value);
  if(Array.isArray(value)){snapshot.tag(9);snapshot.count(value.length);for(const item of value)write(item,depth+1);}
  else {const keys=Object.keys(value);snapshot.tag(10);snapshot.count(keys.length);for(const key of keys){snapshot.text(key);write(value[key],depth+1);}}
  active.delete(value);
 }
 write(value,0);return snapshot.finish();
}
export function checked(result){if(result!==null&&Object.hasOwn(result,'error'))throw new Error(result.error);return result;}
export function selected(entry,generated=false){
 const handler=entry.handler;
 return {event:entry.event,matcher:entry.matcher,...(generated?{generatedId:entry.generatedId}:{}),handler:{type:handler.type,command:handler.command,args:handler.args,timeout:handler.timeout,statusMessage:handler.statusMessage}};
}
export function files(run){
 const errors=[];
 const callback=(operation,args)=>{
  try{
   let value;
   switch(operation){
    case 'resolve':value=path.resolve(...args);break;
    case 'join':value=path.join(...args);break;
    case 'dirname':value=path.dirname(args[0]);break;
    case 'gitDir':value=gitDirRunner(args[0])??null;break;
    case 'excludePathFacts':{const resolved=path.resolve(args[0]);value={resolved,root:path.parse(resolved).root,separator:path.sep,absolute:path.isAbsolute(args[0])};break;}
    case 'excludeTemporary':value=`${args[0]}.poe-code-${process.pid}-${randomUUID()}.tmp`;break;
    case 'cleanupTemporary':value=`${args[0]}.cleanup-${process.pid}-${randomUUID()}.tmp`;break;
    case 'rmdir':fs.rmdirSync(args[0]);value=null;break;
    case 'remove':fs.rmSync(args[0],{force:true});value=null;break;
    case 'pathFacts':{const root=path.parse(args[0]).root,relative=path.relative(args[1]??root,args[0]);value={root,relative,absolute:path.isAbsolute(relative),separator:path.sep};break;}
    case 'readlink':value=fs.readlinkSync(args[0]);break;
    case 'symlink':fs.symlinkSync(...args);value=null;break;
    case 'lstat':{const stats=fs.lstatSync(args[0]);value={symbolic:stats.isSymbolicLink(),file:stats.isFile()};break;}
    case 'read':value=fs.readFileSync(args[0],'utf8');break;
    case 'mkdir':fs.mkdirSync(args[0],{recursive:true});value=null;break;
    case 'write':fs.writeFileSync(args[0],args[1],{flag:'wx'});value=null;break;
    case 'rename':fs.renameSync(...args);value=null;break;
    case 'unlink':fs.unlinkSync(args[0]);value=null;break;
    default:throw new Error(`Unknown hook filesystem operation ${operation}`);
   }
   return JSON.stringify(value);
  }catch(error){const id=errors.push(error)-1;return JSON.stringify({error:id,code:error instanceof Error&&Object.hasOwn(error,'code')?error.code:undefined});}
 };
 const result=run(callback);
 function failure(result){
  if(Object.hasOwn(result,'foreignError'))return errors[result.foreignError];
  if(Object.hasOwn(result,'error'))return new Error(result.error);
  if(Object.hasOwn(result,'userError')){const error=new Error(result.userError.message);error.name=result.userError.name;error.hint=undefined;error.code=result.userError.code;return error;}
  if(Object.hasOwn(result,'aggregateError')){const causes=result.aggregateError.map(failure);const format=error=>error instanceof Error&&error.message.length?error.message:String(error);return new AggregateError(causes,result.originalPrefix+format(causes[0])+' '+result.restorePrefix+format(causes[1]));}
  if(Object.hasOwn(result,'malformedPath')){let cause;try{JSON.parse(result.content);}catch(error){cause=error;}return new Error(`Malformed JSON in ${result.malformedPath}`,{cause});}
 }
 if(result!==null){const error=failure(result);if(error!==undefined||Object.hasOwn(result,'foreignError'))throw error;}

 return checked(result);
}
