import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {FsError} from 'safe-bash-contracts';
import type {ObjectFilePublicationStore,ObjectFileVersion} from '@poe-code/safe-fs/core';
import {createObjectFilePublicationConformanceCases} from '@poe-code/safe-fs/testing/object-publication';
import {createSqlitePageStaging} from './sqlite-page-staging.js';
for(const entry of createObjectFilePublicationConformanceCases({requireStaging:true,async createFixture(){
 const fs=new MemoryFileSystem();await fs.mkdir('/files');await fs.mkdir('/private');
 const acquire=async(path:string):Promise<ObjectFileVersion|undefined>=>{
  try{const stat=await fs.stat(path);assert.ok(stat.size<=16);const bytes=await fs.readFile(path);let closed=false;return {revision:String(stat.revision),stat,async read(position,count,options){options?.signal?.throwIfAborted();if(closed)throw new FsError('EBADF');return bytes.slice(position,position+count);},async close(){closed=true;}};}
  catch(error){if(error instanceof FsError&&error.code==='ENOENT')return undefined;throw error;}
 };
 const store:ObjectFilePublicationStore={
  async acquire(path,options){options.signal?.throwIfAborted();return acquire(path);},
  async publish(path,expectedRevision,source,options){
   // Tiny deterministic publication fixture; this is not a production backend.
   assert.ok(options.size<=16);const bytes=new Uint8Array(options.size);let position=0;
   for await(const part of source){options.signal?.throwIfAborted();bytes.set(part,position);position+=part.length;}
   assert.equal(position,options.size);options.signal?.throwIfAborted();let expected=null;
   try{expected=await fs.stat(path);}catch(error){if(!(error instanceof FsError)||error.code!=='ENOENT')throw error;}
   if((expected===null?null:String(expected.revision))!==expectedRevision)throw new FsError('EAGAIN');
   await fs.writeFileConditional(path,bytes,{...options,parent:await fs.stat('/files'),expected});
   return (await acquire(path))!;
  },
  createStaging(_path,options){return createSqlitePageStaging(fs,{...options,directory:'/private'});}
 };
 return {fs,store,root:'/files',async dispose(){assert.deepEqual(await fs.readdir('/private'),[]);}};
}}))test(entry.name,entry.run);
