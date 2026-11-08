import {compareIdentity} from '@poe-code/safe-fs/core';
import {retainFileSystemCleanup} from '@poe-code/safe-fs/runtime-core';
import type {FileStat} from 'safe-bash-contracts';
import {resolvePath} from 'safe-bash-contracts/path';
import type {PythonPackageContext} from './provisioning.js';

let serial=0;
/** An invocation owns extracted packages until the interpreter has retired. */
export class PythonInstallationRoot {
 private initializing:Promise<string>|undefined;
 private closing:Promise<void>|undefined;
 private cleanup:(()=>Promise<void>)|undefined;
 private owned:{path:string;parent:FileStat;identity:FileStat}|undefined;
 constructor(private readonly context:PythonPackageContext){}
 path(context?:PythonPackageContext):Promise<string>{
  if(this.closing)return Promise.reject(new Error('Python installation root is closed'));
  const initialized=this.initializing??=(async()=>{
   const {fs,signal,cwd}=this.context;
   signal.throwIfAborted();
   this.cleanup=retainFileSystemCleanup(fs,async view=>{
    if(!this.owned)return;
    const {path,parent,identity}=this.owned,current=await view.lstat(path);
    if(compareIdentity(identity,current)!=='same')throw new Error('Python installation root identity changed');
    await view.removeTreeConditional!(path,{parent,expected:current});
    this.owned=undefined;
   });
   await fs.mkdir(cwd,{recursive:true,signal});
   const parentPath=await fs.realpath(cwd,{signal});
   const parent=await fs.stat(parentPath,{signal});
   const capabilities=await fs.capabilitiesFor?.(parentPath,{signal})??fs.capabilities;
   if(!fs.prepareDirectory||!fs.removeTreeConditional||!capabilities.atomicTreeRemoval)throw new Error('Python extracted packages require conditional caller-owned directories');
   for(let attempt=0;attempt<16;attempt++){
    const path=resolvePath(parentPath,'.python-install-'+ ++serial);
    try{
     const identity=await fs.prepareDirectory(path,{parent,expected:null,mode:0o700,signal});
     this.owned={path,parent,identity};
     signal.throwIfAborted();
     return path;
    }catch(error){
     signal.throwIfAborted();
     if(!error||typeof error!=='object'||!('code' in error)||!['EEXIST','EAGAIN'].includes(String(error.code)))throw error;
    }
   }
   throw new Error('Python installation root names exhausted');
  })();
  return context?initialized.then(async path=>{
   if(compareIdentity(this.owned!.identity,await context.fs.lstat(path,{signal:context.signal}))!=='same')throw new Error('Python installation root identity changed');
   return path;
  }):initialized;
 }
 close():Promise<void>{
  return this.closing??=(async()=>{
   await this.initializing?.catch(()=>{});
   await this.cleanup?.();
  })();
 }
}
