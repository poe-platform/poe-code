import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bytes, hash, requireValue } from './common.mjs';
const home=path.dirname(fileURLToPath(import.meta.url));
const directory=path.join(home,'outer-01');
fs.mkdirSync(directory,{mode:0o700});
const receipt={schema:'HARMLESS_OUTER_V1',pid:null,closed:false,status:null,signal:null,observed:[0,0],retained:[0,0],primaryPresent:false,primary:null,cleanup:[],signals:[],captureClosed:[false,false]};
const descriptors=[];let instance,timer,killTimer;const fail=error=>{if(!receipt.primaryPresent){receipt.primaryPresent=true;receipt.primary={type:typeof error,message:String(error).slice(0,1024)};}else receipt.cleanup.push(String(error).slice(0,1024));};
try {
  for(const name of ['stdout.raw','stderr.raw'])descriptors.push(fs.openSync(path.join(directory,name),'wx',0o600));
  const sealRaw=bytes(path.join(home,'SEAL.json'),262144),seal=JSON.parse(sealRaw);
  for(const row of seal.files)bytes(path.join(home,row.path),2093056,row);
  for(const row of seal.inherited)bytes(row.path,2093056,row);
  const authRaw=bytes(process.argv[2],32768);requireValue(hash(authRaw)===process.argv[3],'OUTER_AUTH_HASH');
  const auth=JSON.parse(authRaw),remaining=Date.parse(auth.expiresAt)-Date.now();requireValue(remaining>35000&&remaining<=30*60000,'OUTER_DEADLINE');
  instance=spawn(seal.node.path,['--unhandled-rejections=strict','--max-old-space-size=256',path.join(home,'fixture-parent.mjs'),process.argv[2],process.argv[3]],{cwd:'/Users/kjopek/Workspace/safe-bash',env:{PATH:'',LANG:'C',LC_ALL:'C',HOME:directory},stdio:['ignore','pipe','pipe']});
  receipt.pid=instance.pid;
  const closed=new Promise(resolve=>instance.once('close',(status,signal)=>{Object.assign(receipt,{closed:true,status,signal});resolve();}));
  instance.on('error',fail);
  const signal=value=>{receipt.signals.push(value);try{instance.kill(value);}catch(error){fail(error);}};
  for(const [index,stream]of [[0,instance.stdout],[1,instance.stderr]])stream.on('data',chunk=>{
    receipt.observed[index]+=chunk.length;const available=Math.max(0,65536-receipt.retained[index]);const kept=Math.min(available,chunk.length);
    try{let offset=0;while(offset<kept){const size=fs.writeSync(descriptors[index],chunk,offset,kept-offset);requireValue(size>0,'OUTER_SHORT_WRITE');offset+=size;receipt.retained[index]+=size;}requireValue(kept===chunk.length,'OUTER_CAPTURE_CAP');}catch(error){fail(error);signal('SIGTERM');}
  });
  timer=setTimeout(()=>{fail(new Error('OUTER_DEADLINE'));signal('SIGTERM');killTimer=setTimeout(()=>signal('SIGKILL'),2000);},remaining);
  await closed;
}catch(error){fail(error);}
finally{
 clearTimeout(timer);clearTimeout(killTimer);
 for(const [index,descriptor]of descriptors.entries()){try{fs.fsyncSync(descriptor);}catch(error){fail(error);}try{fs.closeSync(descriptor);receipt.captureClosed[index]=true;}catch(error){fail(error);}}
}
receipt.qualified=receipt.closed&&receipt.signal===null&&!receipt.primaryPresent&&receipt.captureClosed.every(Boolean)&&receipt.observed.every((value,index)=>value===receipt.retained[index]);
const data=Buffer.from(JSON.stringify(receipt,null,2)+'\n');requireValue(data.length<=262144,'OUTER_RECEIPT_CAP');fs.writeFileSync(path.join(directory,'RECEIPT.json'),data,{flag:'wx',mode:0o600});
console.log(JSON.stringify({closed:receipt.closed,qualified:receipt.qualified,status:receipt.status,observed:receipt.observed,retained:receipt.retained}));process.exitCode=receipt.qualified&&receipt.status===0?0:1;
