/** Node-server-only POSIX execve adapter. The executable is verified before
 * service admission and must remain in an authenticated immutable deployment. */
import {spawn as nodeSpawn,type ChildProcess,type SpawnOptions} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {getSystemErrorName} from 'node:util';
import type {Readable,Writable} from 'node:stream';
import {createNativeLauncher,type NativeLauncher} from './native-process.js';
import type {Outcome} from './wire.generated.js';

export interface ByteArgvLauncherOptions {
 helperExecutable:string;
 helperDigest:string;
 maxHelperBytes:number;
}
export async function createByteArgvLauncher(options:ByteArgvLauncherOptions,dependencies:{
 open?:(path:string)=>AsyncIterable<Uint8Array>;
 spawn?:(executable:string,args:string[],options:SpawnOptions)=>ChildProcess;
 killGroup?:(pid:number,signal:NodeJS.Signals)=>void;
 groupAlive?:(pid:number)=>boolean;
 terminationTimeoutMs?:number;
}={}):Promise<NativeLauncher> {
 options={...options};dependencies={...dependencies};
 const {helperExecutable,helperDigest,maxHelperBytes}=options;
 if(typeof helperExecutable!=='string'||!helperExecutable.startsWith('/')||helperExecutable.includes('\0')||new TextDecoder('utf-8',{ignoreBOM:true}).decode(new TextEncoder().encode(helperExecutable))!==helperExecutable)throw new TypeError('Invalid execve helper path');
 if(typeof helperDigest!=='string'||helperDigest.length!==64||Array.from(helperDigest).some(c=>!'0123456789abcdef'.includes(c)))throw new TypeError('Invalid execve helper digest');
 if(!Number.isSafeInteger(maxHelperBytes)||maxHelperBytes<1)throw new TypeError('Invalid execve helper bound');
 const open=dependencies.open??createReadStream;
 const hash=createHash('sha256');let size=0;
 for await(const bytes of open(helperExecutable)){
  if(!(bytes instanceof Uint8Array))throw new TypeError('Invalid execve helper bytes');
  const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(bytes) as number;
  if(length>maxHelperBytes-size)throw new TypeError('Execve helper byte bound');
  size+=length;hash.update(bytes);
 }
 if(hash.digest('hex')!==helperDigest)throw new TypeError('Execve helper digest mismatch');
 const spawn=dependencies.spawn??nodeSpawn;
 const maxDescriptors=1022;const maxArgvBytes=1048576;
 const launcher=createNativeLauncher({maxDescriptors,maxArgvBytes,killGroup:dependencies.killGroup,groupAlive:dependencies.groupAlive,terminationTimeoutMs:dependencies.terminationTimeoutMs,
  spawnOctets(executable,args,profile){
   // These are private adapter pipes after every admitted native descriptor.
   // Native stdout/stderr and extra descriptors retain their original slots.
   const stdio=profile.stdio as ('pipe'|'ignore'|number)[];
   if(stdio.length>maxDescriptors)throw new TypeError('Execve helper descriptor bound');
   let total=0;for(const arg of args)total+=arg.length+1;
   if(total>maxArgvBytes)throw new TypeError('Execve helper argv byte bound');
   const inputFd=stdio.length;const diagnosticFd=inputFd+1;
   const body=Buffer.alloc(12+4*args.length+total-args.length);
   body.write('RMA1',0,'ascii');body.writeUInt32BE(args.length,4);body.writeUInt32BE(total,8);
   let offset=12;for(const arg of args){body.writeUInt32BE(arg.length,offset);offset+=4;for(const octet of arg)body[offset++]=octet;}
   const child=spawn(helperExecutable,[executable,String(inputFd),String(diagnosticFd)],{...profile,stdio:[...stdio,'pipe','pipe']});
   const input=child.stdio[inputFd] as Writable|null;
   const diagnostic=child.stdio[diagnosticFd] as Readable|null;
   const write=new Promise<void>((resolve,reject)=>{
    if(!input){reject(new Error('Native launch diagnostic input unavailable'));return;}
    // A missing helper may emit an error before end's receipt. Always observe
    // the pipe error; it must never become an unhandled process-level event.
    input.on('error',reject);input.end(body,(error?:Error|null)=>error?reject(error):resolve());
   });void write.catch(()=>{});
   const launchOutcome=(async():Promise<Outcome|undefined>=>{
    if(!diagnostic)throw new Error('Native launch diagnostic channel unavailable');
    const record=Buffer.alloc(8);let count=0;
    try{
     for await(const chunk of diagnostic){
      const bytes=chunk as Uint8Array;
      if(bytes.length>8-count)throw new Error('Native launch diagnostic length bound');
      record.set(bytes,count);count+=bytes.length;
     }
     if(count===0){await write;return;}
     // A failed exec may close request input before its receipt. Its explicit
     // errno remains authoritative; draining that failure is still required.
     await write.catch(()=>{});
     if(count!==8||record.subarray(0,4).toString('ascii')!=='RME1')throw new Error('Native launch diagnostic malformed');
     const errno=record.readUInt32BE(4);
     if(errno<1||errno>4095)throw new Error('Native launch diagnostic errno invalid');
     return {kind:'spawnError',code:getSystemErrorName(-errno),stage:'spawn',message:'Native execve could not be completed'};
    }catch(cause){throw new Error('Native launch diagnostic unavailable',{cause});}
   })();void launchOutcome.catch(()=>{});
   return {child,launchOutcome};
  },
 });
 return Object.freeze({...launcher,argvProfile:Object.freeze({kind:'bytes' as const,revision:'posix-execve-v1:'+helperDigest,maxArgvBytes,maxDescriptors,evidence:Object.freeze(['Checksum-verified POSIX execve helper; bounded private argv and errno pipes'])})});
}
