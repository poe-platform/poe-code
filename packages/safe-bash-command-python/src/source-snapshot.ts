import {compareIdentity} from '@poe-code/safe-fs/core';
import {FsError,type CommandContext,type FileStat} from 'safe-bash-contracts';
import {resolvePath} from 'safe-bash-contracts/path';
import {yieldTurn} from 'safe-bash-contracts/yield';
import {admitCopySource,admitCopyDestination,copyCheckedSource} from 'safe-bash-io-engine/commands/copy-source';

export interface PythonSourceSnapshot {
 readonly path:string;
 /** Retires only the owned tree; substituted identities are never removed. */
 dispose():Promise<void>;
}
let serial=0;

/** Copy a build tree into caller storage using pip 21.2.4's directory policy. */
export async function createPythonSourceSnapshot(source:string,directory:string,context:CommandContext):Promise<PythonSourceSnapshot> {
 const {fs,signal}=context,settings={signal};
 signal.throwIfAborted();
 if(!fs.iterateDirectory)throw new Error('Python source snapshots require lazy directory enumeration');
 const origin=await fs.realpath(resolvePath(context.cwd,source),settings);
 const parentPath=await fs.realpath(resolvePath(context.cwd,directory),settings);
 const capabilities=await fs.capabilitiesFor?.(parentPath,settings)??fs.capabilities;
 if(!fs.prepareDirectory||!fs.removeTreeConditional||!fs.confineExtraction||!capabilities.atomicTreeRemoval)throw new Error('Python source snapshots require confined writes, conditional directory creation and tree removal');
 const original=await fs.stat(origin,settings),parent=await fs.stat(parentPath,settings);
 if(original.type!=='directory'||parent.type!=='directory')throw new FsError('ENOTDIR',{path:origin});
 let path='',owned:FileStat|undefined;
 for(let attempt=0;attempt<16;attempt++){
  path=resolvePath(parentPath,'.python-source-'+ ++serial);
  try{owned=await fs.prepareDirectory(path,{parent,expected:null,mode:0o700,signal});break;}
  catch(error){signal.throwIfAborted();if(!(error instanceof FsError)||!['EEXIST','EAGAIN'].includes(error.code))throw error;}
 }
 if(!owned)throw new Error('Python source snapshot names exhausted');
 let disposing:Promise<void>|undefined;
 const snapshot:PythonSourceSnapshot={path,dispose(){return disposing??=(async()=>{
  const current=await fs.lstat(path);
  if(compareIdentity(owned,current)!=='same')throw new Error('Python source snapshot identity changed');
  await fs.removeTreeConditional!(path,{parent,expected:current});
 })();}};
 try{
 const destination=await fs.confineExtraction([path],settings);
 if(compareIdentity(owned,await fs.lstat(path,settings))!=='same')throw new Error('Python source snapshot identity changed');
 // Source reads retain the caller's original authority; every destination
 // mutation goes through the confined view, including streamed writes.
 let activeCleanup:(()=>void|Promise<void>)|undefined;
 context.registerCleanup?.(()=>activeCleanup?.());
 const copyContext={...context,registerCleanup(cleanup:()=>void|Promise<void>){activeCleanup=cleanup;},fs:new Proxy(destination,{get(target,key){
  const owner=key==='openReadFile'?fs:target,value=Reflect.get(owner,key);
  return typeof value==='function'?value.bind(owner):value;
 }})};
 const metadata=async(from:string,to:string,expected:FileStat)=>{
  const current=await fs.lstat(from,settings);
  if(compareIdentity(expected,current)!=='same')throw new Error('Python source identity changed while copying');
  if(destination.chmod)await destination.chmod(to,current.mode&0o7777,settings);
  if(destination.utimes)await destination.utimes(to,current.atimeMs,current.mtimeMs,settings);
 };
 const copy=async(from:string,to:string,expected:FileStat):Promise<void>=>{
  signal.throwIfAborted();
  if(expected.type==='symlink'){
   if(!destination.symlink||!fs.readlink)throw new Error('Python source snapshots require symlink support');
   const target=await fs.readlink(from,settings);
   if(compareIdentity(expected,await fs.lstat(from,settings))!=='same')throw new Error('Python source identity changed while copying');
   await destination.symlink(target,to,settings);
   return;
  }
  if(expected.type==='file'){
   await admitCopySource(context,from);await admitCopyDestination(copyContext,to,true);
   try{await copyCheckedSource(copyContext,from,to,expected,true);}finally{activeCleanup=undefined;}
  }else if(expected.type==='directory'){
   if(to!==path)await destination.mkdir(to,{mode:0o700,signal});
   for await(const entry of fs.iterateDirectory!(from,settings)){
    await yieldTurn(signal);
    if(!entry.name||entry.name==='.'||entry.name==='..'||entry.name.includes('/')||entry.name.includes('\0'))throw new Error('Invalid Python source directory entry');
    const child=resolvePath(from,entry.name);
    if(child===path||from===origin&&['.tox','.nox'].includes(entry.name))continue;
    await copy(child,resolvePath(to,entry.name),await fs.lstat(child,settings));
   }
  }else throw new Error('Unsupported Python source entry: '+from);
  await metadata(from,to,expected);
 };
 await copy(origin,path,original);signal.throwIfAborted();return snapshot;}
 catch(error){try{await snapshot.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Python source snapshot cleanup failed');}throw error;}
}
