import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runCapturedStartup,startupReceipt} from './startup-capture-v3.mjs';
const home=fileURLToPath(new URL('.',import.meta.url)).slice(0,-1);
const read=(file,maximum)=>{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error('startup input admission');return fs.readFileSync(file);};
const record=await runCapturedStartup({paths:[home+'/validation-v2/outer/owner-r1.stdout',home+'/validation-v2/outer/owner-r1.stderr'],authenticate:()=>{
 const seal=JSON.parse(read(home+'/PRESEAL-v5.json',2097152));for(const row of seal.files){const body=read(home+'/'+row.path,4194304);if(body.length!==row.bytes||createHash('sha256').update(body).digest('hex')!==row.sha256)throw Error('startup seal identity');}
 const parents=JSON.parse(read(home+'/PARENTS.json',65536));for(const parent of parents.created){const stat=fs.lstatSync(parent.path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.dev!==parent.device||stat.ino!==parent.inode||fs.realpathSync(parent.path)!==parent.path)throw Error('startup parent identity');}
 const control=JSON.parse(read(home+'/CONTROL-v5.json',65536));const timeoutMs=Math.floor(Math.min(control.outerWallMs,control.absoluteDeadline-Date.now()));
 return {executable:process.execPath,args:['--experimental-permission','--allow-child-process',...control.readRoots.map(value=>'--allow-fs-read='+value),'--allow-fs-write='+control.authorizedOutputRoot,path.join(home,'owner-v5.mjs')],cwd:home,env:control.environment,timeoutMs,captureBytes:control.outerCaptureBytes};
}});
const receipt=startupReceipt(record);fs.writeFileSync(home+'/validation-v2/outer/RECEIPT-r1.json',JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(receipt)+'\n');process.exitCode=receipt.clean&&receipt.code===0?0:1;
