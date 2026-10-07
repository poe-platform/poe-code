import {compareIdentity} from '@poe-code/safe-fs/core';
import type {FileStat} from 'safe-bash-contracts';
import {resolvePath} from 'safe-bash-contracts/path';
import type {PythonPackageContext} from './provisioning.js';

let serial=0;
/** An invocation owns extracted packages until the interpreter has retired. */
export class PythonInstallationRoot {
 private initializing:Promise<string>|undefined;
 private closing:Promise<void>|undefined;
 private owned:{path:string;parent:FileStat;identity:FileStat}|undefined;
 constructor(private readonly context:PythonPackageContext){}
 path():Promise<string>{
  if(this.closing)return Promise.reject(new Error('Python installation root is closed'));
  return this.initializing??=(async()=>{
   const {fs,signal,cwd}=this.context;
   signal.throwIfAborted();
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
 }
 close():Promise<void>{
  return this.closing??=(async()=>{
   await this.initializing?.catch(()=>{});
   if(!this.owned)return;
   const {fs}=this.context,{path,parent,identity}=this.owned;
   const current=await fs.lstat(path);
   if(compareIdentity(identity,current)!=='same')throw new Error('Python installation root identity changed');
   await fs.removeTreeConditional!(path,{parent,expected:current});
   this.owned=undefined;
  })();
 }
}
