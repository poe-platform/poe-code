import {FsError} from '../contracts/errors.js';
import type {DirectoryEntry,FileSystem,FsOptions} from '../contracts/filesystem.js';

/** One prefetched entry makes acquisition errors eager without buffering a listing. */
export class PythonDirectory {
 #first:IteratorResult<DirectoryEntry>|undefined;
 #tail:Promise<unknown>=Promise.resolve();
 #closing:Promise<void>|undefined;
 #count=0;
 readonly #iterator:AsyncIterator<DirectoryEntry>;
 readonly #options:FsOptions;
 readonly #limit:number;
 constructor(fs:FileSystem,path:string,options:FsOptions,limit:number){
  this.#options=options;this.#limit=limit;
  const source=fs.iterateDirectory?fs.iterateDirectory(path,options):(async function*(){yield* await fs.readdir(path,{...options,...limit===Infinity?{}:{maxEntries:limit}});})();
  this.#iterator=source[Symbol.asyncIterator]();
 }
 async prepare():Promise<void>{this.#first=await this.#iterator.next();}
 next():Promise<string|null>{
  if(this.#closing)return Promise.reject(new FsError('EBADF'));
  const work=this.#tail.then(async()=>{
   this.#options.signal?.throwIfAborted();
   const value=this.#first??await this.#iterator.next();this.#first=undefined;
   this.#options.signal?.throwIfAborted();
   if(value.done)return null;
   if(++this.#count>this.#limit)throw new FsError('EFBIG',{syscall:'readdir'});
   return value.value.name;
  });
  this.#tail=work.catch(()=>{});return work;
 }
 close():Promise<void>{
  return this.#closing??=this.#tail.then(async()=>{this.#first=undefined;await this.#iterator.return?.();});
 }
}
