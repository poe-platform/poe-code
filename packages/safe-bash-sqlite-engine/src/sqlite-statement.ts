import {FsError} from 'safe-bash-contracts';
import {yieldTurn} from 'safe-bash-contracts/yield';
import type {SqliteBlobModule} from './sqlite-blob.js';
export type SqliteBinding=null|bigint|number|string|Uint8Array;
export type SqliteColumn='blob'|'text'|'integer'|'real'|'null';
export interface SqliteStatement {columns():readonly string[];rows(bindings:readonly SqliteBinding[],columns:readonly SqliteColumn[]):AsyncIterable<SqliteBinding[]>}
// Private bounded control/scalar queries only. Large record fields use retained
// physical spans or incremental blobs; do not select arbitrary large values here.
export async function withSqliteStatement<T>(module:SqliteBlobModule,options:{database:number;sql:string;single?:boolean;signal:AbortSignal;check():void},operation:(statement:SqliteStatement)=>Promise<T>):Promise<T>{
 const {database,sql,signal,check}=options;
 signal.throwIfAborted();check();
 const encoder=new TextEncoder(),decoder=new TextDecoder();
 if(sql.includes('\0')||sql.length>65536||encoder.encode(sql).length>65536)throw new RangeError('SQLite control exceeds byte budget or contains NUL');
 const prepare=module.cwrap('sqlite3_prepare_v2','number',['number','string','number','number','number'],{async:true}) as (db:number,sql:string,length:number,out:number,tail:number)=>Promise<number>;
 const step=module.cwrap('sqlite3_step','number',['number'],{async:true}) as (stmt:number)=>Promise<number>;
 const reset=module.cwrap('sqlite3_reset','number',['number'],{async:true}) as (stmt:number)=>Promise<number>;
 const finalize=module.cwrap('sqlite3_finalize','number',['number'],{async:true}) as (stmt:number)=>Promise<number>;
 const clear=module.cwrap('sqlite3_clear_bindings','number',['number']) as (stmt:number)=>number;
 const parameters=module.cwrap('sqlite3_bind_parameter_count','number',['number']) as (stmt:number)=>number;
 const count=module.cwrap('sqlite3_column_count','number',['number']) as (stmt:number)=>number;
 const type=module.cwrap('sqlite3_column_type','number',['number','number']) as (stmt:number,col:number)=>number;
 const length=module.cwrap('sqlite3_column_bytes','number',['number','number']) as (stmt:number,col:number)=>number;
 const blob=module.cwrap('sqlite3_column_blob','number',['number','number']) as (stmt:number,col:number)=>number;
 const text=module.cwrap('sqlite3_column_text','number',['number','number']) as (stmt:number,col:number)=>number;
 const real=module.cwrap('sqlite3_column_double','number',['number','number']) as (stmt:number,col:number)=>number;
 const bindNull=module.cwrap('sqlite3_bind_null','number',['number','number']) as (stmt:number,col:number)=>number;
 const bindReal=module.cwrap('sqlite3_bind_double','number',['number','number','number']) as (stmt:number,col:number,value:number)=>number;
 const bindInt=module.cwrap('sqlite3_bind_int64','number',['number','number','number','number']) as (stmt:number,col:number,lo:number,hi:number)=>number;
 const bindBlob=module.cwrap('sqlite3_bind_blob','number',['number','number','number','number','number']) as (stmt:number,col:number,pointer:number,size:number,destructor:number)=>number;
 const bindText=module.cwrap('sqlite3_bind_text','number',['number','number','number','number','number']) as typeof bindBlob;
 const result=(code:number):void=>{
  check();if(code===0)return;
  let message=`Native SQLite statement failed (${code})`;
  if(options.single){
   const errorMessage=module.cwrap('sqlite3_errmsg','number',['number']) as (database:number)=>number;
   const pointer=errorMessage(database);let end=pointer;
   if(pointer>0&&pointer<module.HEAPU8.length){
    while(end<module.HEAPU8.length&&end-pointer<65536&&module.HEAPU8[end])end++;
    if(end<module.HEAPU8.length&&module.HEAPU8[end]===0)message=decoder.decode(module.HEAPU8.subarray(pointer,end));
   }
  }
  throw new FsError('EIO',{message});
 };
 let out=0,sqlPointer=0,statement=0,accepting=true,current:AsyncGenerator<SqliteBinding[]>|undefined,value!:T;
 const errors:unknown[]=[];
 const resetCursor=async(failed:boolean,failure:unknown):Promise<void>=>{
  try{const code=await reset(statement);if(!failed)result(code);}
  catch(error){if(failed&&error!==failure)throw new AggregateError([failure,error],'SQLite cursor and reset failed');throw error;}
  finally{current=undefined;}
 };
 const rows=(bindings:readonly SqliteBinding[],columns:readonly SqliteColumn[]):AsyncGenerator<SqliteBinding[]>=>{
  async function* iterate():AsyncGenerator<SqliteBinding[]>{
   if(!accepting)throw new FsError('EBADF',{message:'SQLite statement is closed'});
   if(current)throw new FsError('EBUSY',{message:'SQLite cursor is already active'});
   current=iterator;
   let failed=false,failure:unknown;
   try{
    signal.throwIfAborted();check();
    if(bindings.length!==parameters(statement)||columns.length!==count(statement)||columns.length>32)throw new RangeError('SQLite parameter or column count mismatch');
    // Own controls before the first asynchronous native call.
    let budget=0;
    const owned=bindings.map(value=>{
     if(typeof value==='string'||value instanceof Uint8Array){
      if(value.length>65536)throw new RangeError('SQLite binding exceeds scalar byte budget');
      const bytes=typeof value==='string'?encoder.encode(value):value.slice();budget+=bytes.length;
      if(bytes.length>65536||budget>65536)throw new RangeError('SQLite bindings exceed byte budget');
      return {bytes,text:typeof value==='string'};
     }
     if(typeof value==='bigint'&&(value<-(1n<<63n)||value>=(1n<<63n)))throw new RangeError('SQLite integer out of range');
     if(typeof value==='number'&&!Number.isFinite(value))throw new RangeError('SQLite real must be finite');
     return value;
    });
    const formats=columns.slice();
    result(clear(statement));
    for(let index=0;index<owned.length;index++){
     const value=owned[index]!;
     if(value===null)result(bindNull(statement,index+1));
     else if(typeof value==='bigint')result(bindInt(statement,index+1,Number(BigInt.asIntN(32,value)),Number(BigInt.asIntN(32,value>>32n))));
     else if(typeof value==='number')result(bindReal(statement,index+1,value));
     else{
      const pointer=module._malloc(Math.max(1,value.bytes.length));
      if(!pointer)throw new RangeError('SQLite memory allocation failed');
      try{module.HEAPU8.set(value.bytes,pointer);result((value.text?bindText:bindBlob)(statement,index+1,pointer,value.bytes.length,-1));}finally{module._free(pointer);}
     }
    }
    while(true){
     await yieldTurn(signal);check();
     const code=await step(statement);check();signal.throwIfAborted();
     if(code===101)return;
     if(code!==100){result(code);return;}
     const row:SqliteBinding[]=[];
     for(let col=0;col<formats.length;col++){
      const format=formats[col]!,expected={integer:1,real:2,text:3,blob:4,null:5}[format];
      if(type(statement,col)!==expected)throw new TypeError('Unexpected SQLite scalar type');
      if(format==='null'){row.push(null);continue;}
      if(format==='real'){row.push(real(statement,col));continue;}
      // Integer-to-text conversion is bounded to 20 ASCII bytes. Blob/text
      // sizes are inspected without requesting a coercing native accessor.
      const integerPointer=format==='integer'?text(statement,col):0;
      const size=length(statement,col);
      if(size<0||size>(format==='integer'?20:65536))throw new RangeError('SQLite scalar exceeds byte budget');
      const pointer=format==='integer'?integerPointer:format==='blob'?blob(statement,col):text(statement,col);
      if(size&&(!pointer||pointer+size>module.HEAPU8.length))throw new RangeError('Invalid SQLite scalar address');
      const bytes=module.HEAPU8.slice(pointer,pointer+size);
      row.push(format==='blob'?bytes:format==='integer'?BigInt(decoder.decode(bytes)):decoder.decode(bytes));
     }
     yield row;
    }
   }catch(error){failed=true;failure=error;throw error;}
   finally{
    await resetCursor(failed,failure);
   }
  }
  const iterator=iterate();return iterator;
 };
 try{
  out=module._malloc(options.single?8:4);if(!out)throw new RangeError('SQLite memory allocation failed');
  new DataView(module.HEAPU8.buffer).setInt32(out,0,true);
  let code:number;
  if(options.single){
   const bytes=encoder.encode(sql);sqlPointer=module._malloc(bytes.length+1);if(!sqlPointer)throw new RangeError('SQLite memory allocation failed');
   module.HEAPU8.set(bytes,sqlPointer);module.HEAPU8[sqlPointer+bytes.length]=0;
   new DataView(module.HEAPU8.buffer).setInt32(out+4,0,true);
   const ownedPrepare=module.cwrap('sqlite3_prepare_v2','number',['number','number','number','number','number'],{async:true}) as (db:number,sql:number,length:number,out:number,tail:number)=>Promise<number>;
   code=await ownedPrepare(database,sqlPointer,bytes.length+1,out,out+4);
   statement=new DataView(module.HEAPU8.buffer).getInt32(out,true);result(code);
   const tail=new DataView(module.HEAPU8.buffer).getInt32(out+4,true);
   if(tail<sqlPointer||tail>sqlPointer+bytes.length)throw new RangeError('Invalid SQLite statement tail');
   for(let position=tail;position<sqlPointer+bytes.length;position++)if(![9,10,11,12,13,32].includes(module.HEAPU8[position]!))throw new TypeError('Expected a single SQLite statement');
  }else{code=await prepare(database,sql,-1,out,0);statement=new DataView(module.HEAPU8.buffer).getInt32(out,true);}
  result(code);signal.throwIfAborted();if(!statement)throw new FsError('EIO',{message:'SQLite returned an empty statement'});
  value=await operation({rows,columns(){
   if(!accepting)throw new FsError('EBADF',{message:'SQLite statement is closed'});
   signal.throwIfAborted();check();
   const names:string[]=[],size=count(statement);
   const name=module.cwrap('sqlite3_column_name','number',['number','number']) as (statement:number,column:number)=>number;
   let budget=65536;
   for(let index=0;index<size;index++){
    const pointer=name(statement,index);let end=pointer;
    if(pointer<=0||pointer>=module.HEAPU8.length)throw new RangeError('Invalid SQLite column name');
    while(end<module.HEAPU8.length&&module.HEAPU8[end]){if(--budget<0)throw new RangeError('SQLite column names exceed byte budget');end++;}
    if(end===module.HEAPU8.length)throw new RangeError('Invalid SQLite column name');
    names.push(decoder.decode(module.HEAPU8.subarray(pointer,end)));
   }
   return names;
  }});
 }catch(error){errors.push(error);}
 accepting=false;
 if(current)try{await current.return(undefined);}catch(error){if(!errors.includes(error))errors.push(error);}
 if(!statement&&out)statement=new DataView(module.HEAPU8.buffer).getInt32(out,true);
 if(statement)try{const code=await finalize(statement);if(code!==0&&!errors.length)result(code);}catch(error){if(!errors.includes(error))errors.push(error);}
 if(sqlPointer)try{module._free(sqlPointer);}catch(error){errors.push(error);}
 if(out)try{module._free(out);}catch(error){errors.push(error);}
 if(!errors.length)try{check();signal.throwIfAborted();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'SQLite statement and cleanup failed');return value;
}
