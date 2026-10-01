import {FsError} from 'safe-bash-contracts';
import type {SqliteBlobModule} from './sqlite-blob.js';
import type {SqliteNormalizedToken} from './sqlite-tokenizer.js';

/** The engine reserves slot once when initializing its static callback table.
 * Reuse that slot across transactions; this scope never grows the native table.
 * Native tokenization is synchronous and bounded. Large inputs use the streamed
 * unicode61 adapter. No tokenizer or callback may outlive this scope. */
export async function withNativeUnicode61<T>(module:SqliteBlobModule,options:{
 database:number;table:Pick<WebAssembly.Table,'get'|'set'>;callbackModule:WebAssembly.Module;
 slot:number;signal:AbortSignal;check():void;
},operation:(tokenize:(bytes:Uint8Array)=>Iterable<SqliteNormalizedToken>)=>Promise<T>):Promise<T>{
 const {database,table,callbackModule,slot,signal,check}=options;
 signal.throwIfAborted();check();
 if(!Number.isSafeInteger(slot)||slot<0)throw new RangeError('Invalid SQLite callback slot');
 if(table.get(slot)!==null)throw new FsError('EBUSY',{message:'SQLite callback slot is occupied'});
 const prepare=module.cwrap('sqlite3_prepare_v2','number',['number','string','number','number','number'],{async:true}) as (db:number,sql:string,size:number,out:number,tail:number)=>Promise<number>;
 const bind=module.cwrap('sqlite3_bind_pointer','number',['number','number','number','string','number']) as (stmt:number,col:number,value:number,type:string,destructor:number)=>number;
 const step=module.cwrap('sqlite3_step','number',['number'],{async:true}) as (stmt:number)=>Promise<number>;
 const finalize=module.cwrap('sqlite3_finalize','number',['number'],{async:true}) as (stmt:number)=>Promise<number>;
 const allocations:number[]=[],errors:unknown[]=[];
 let statementOut=0,statement=0,instanceOut=0,instance=0,tokenizer=0,accepting=false,installed=false;
 let value!:T,collecting=false,received:SqliteNormalizedToken[]=[],inputLength=0,outputBytes=0,previousEnd=0;
 let callbackFailed=false,callbackFailure:unknown;
 const int=(pointer:number):number=>new DataView(module.HEAPU8.buffer).getInt32(pointer,true);
 const alloc=(size:number):number=>{const pointer=module._malloc(size);if(!pointer)throw new RangeError('SQLite allocation failed');allocations.push(pointer);module.HEAPU8.fill(0,pointer,pointer+size);return pointer;};
 const result=(code:number):void=>{check();if(code!==0)throw new FsError('EIO',{message:`Native SQLite tokenizer failed (${code})`});};
 const invoke=(index:number,...args:number[]):number=>{
  const fn:unknown=table.get(index);
  if(typeof fn!=='function')throw new FsError('EIO',{message:'Missing SQLite tokenizer function'});
  return (fn as (...args:number[])=>number)(...args);
 };
 const capture=(_context:number,_flags:number,pointer:number,length:number,start:number,end:number):number=>{
  try{
   if(!collecting)throw new FsError('EBADF',{message:'SQLite tokenizer callback outside tokenization'});
   signal.throwIfAborted();check();
   if(![pointer,length,start,end].every(Number.isSafeInteger)||pointer<0||length<0||pointer+length>module.HEAPU8.length||start<previousEnd||end<=start||end>inputLength)throw new TypeError('Invalid native SQLite token');
   outputBytes+=length;
   if(outputBytes>inputLength*4||received.length>=inputLength)throw new RangeError('SQLite token output exceeds its byte budget');
   previousEnd=end;
   received.push({bytes:module.HEAPU8.slice(pointer,pointer+length),start,end});return 0;
  }catch(error){if(!callbackFailed){callbackFailed=true;callbackFailure=error;}return 1;}
 };
 const tokenize=(bytes:Uint8Array):Iterable<SqliteNormalizedToken>=>{
  if(!accepting)throw new FsError('EBADF',{message:'SQLite tokenizer is closed'});
  if(collecting)throw new FsError('EBUSY',{message:'SQLite tokenizer is active'});
  signal.throwIfAborted();check();
  if(!(bytes instanceof Uint8Array)||bytes.length>65536)throw new RangeError('SQLite tokenizer input exceeds its byte budget');
  if(!bytes.length)return [];
  const pointer=module._malloc(bytes.length+1);
  if(!pointer)throw new RangeError('SQLite allocation failed');
  const failures:unknown[]=[];let tokens!:SqliteNormalizedToken[];
  try{
   module.HEAPU8.set(bytes,pointer);module.HEAPU8[pointer+bytes.length]=0;
   received=[];inputLength=bytes.length;outputBytes=0;previousEnd=0;callbackFailed=false;callbackFailure=undefined;collecting=true;
   const code=invoke(int(tokenizer+8),instance,0,4,pointer,bytes.length,slot);
   if(callbackFailed)throw callbackFailure;
   result(code);signal.throwIfAborted();tokens=received;
  }catch(error){failures.push(error);}
  collecting=false;
  try{module._free(pointer);}catch(error){failures.push(error);}
  if(failures.length===1)throw failures[0];if(failures.length)throw new AggregateError(failures,'SQLite tokenization and buffer cleanup failed');return tokens;
 };
 try{
  const wrapper=new WebAssembly.Instance(callbackModule,{e:{f:capture}}).exports.f;
  if(typeof wrapper!=='function')throw new TypeError('Invalid SQLite tokenizer callback module');
  table.set(slot,wrapper);installed=true;
  statementOut=alloc(4);const apiOut=alloc(4),context=alloc(4),name=alloc(10);
  tokenizer=alloc(12);instanceOut=alloc(4);
  module.HEAPU8.set(new TextEncoder().encode('unicode61'),name);
  const code=await prepare(database,'SELECT fts5(?1)',-1,statementOut,0);statement=int(statementOut);
  result(code);signal.throwIfAborted();
  if(!statement)throw new FsError('EIO',{message:'Missing SQLite FTS API statement'});
  result(bind(statement,1,apiOut,'fts5_api_ptr',0));
  const status=await step(statement);check();signal.throwIfAborted();
  if(status!==100)throw new FsError('EIO',{message:`SQLite FTS API lookup failed (${status})`});
  const api=int(apiOut);if(!api)throw new FsError('EIO',{message:'Missing SQLite FTS API'});
  const closing=statement;statement=0;new DataView(module.HEAPU8.buffer).setInt32(statementOut,0,true);
  result(await finalize(closing));signal.throwIfAborted();
  result(invoke(int(api+8),api,name,context,tokenizer));
  const created=invoke(int(tokenizer),int(context),0,0,instanceOut);instance=int(instanceOut);result(created);
  if(!instance)throw new FsError('EIO',{message:'Missing native SQLite tokenizer'});
  accepting=true;value=await operation(tokenize);
 }catch(error){errors.push(error);}
 accepting=false;
 if(!instance&&instanceOut)instance=int(instanceOut);
 if(instance)try{invoke(int(tokenizer+4),instance);}catch(error){errors.push(error);}
 if(!statement&&statementOut)statement=int(statementOut);
 if(statement)try{result(await finalize(statement));}catch(error){if(!errors.includes(error))errors.push(error);}
 if(installed)try{table.set(slot,null);}catch(error){errors.push(error);}
 for(const pointer of allocations.reverse())try{module._free(pointer);}catch(error){errors.push(error);}
 if(!errors.length)try{check();signal.throwIfAborted();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'SQLite tokenizer operation and cleanup failed');return value;
}
