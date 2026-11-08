import {FsError} from 'safe-bash-contracts';
import type {SqliteRecordSource} from './sqlite-pages.js';
import type {SqliteRecordValue} from './sqlite-record.js';
import {readSqliteVarint} from './sqlite-varint.js';
import {sqliteSourceChunks} from './sqlite-stream.js';

/** Decode only bounded record headers and scalar fields. Variable-length fields
 * remain streams tied to the owning snapshot, including empty TEXT/BLOB values. */
export async function readSqliteRecord(record:SqliteRecordSource,options:{signal:AbortSignal;maxColumns:number}):Promise<SqliteRecordValue[]>{
 const {signal,maxColumns}=options;
 if(!Number.isSafeInteger(maxColumns)||maxColumns<0||maxColumns>65536)throw new RangeError('Invalid SQLite column budget');
 const corrupt=():never=>{throw new FsError('EIO',{message:'Invalid SQLite record encoding'});};
 if(!Number.isSafeInteger(record.size)||record.size<1)corrupt();
 const read=async(offset:number,length:number):Promise<Uint8Array>=>{
  signal.throwIfAborted();
  if(offset<0||length<0||offset+length>record.size)corrupt();
  const bytes=new Uint8Array(length);let position=0;
  for await(const chunk of sqliteSourceChunks(record.bytes(offset,length),signal)){
   signal.throwIfAborted();
   if(!(chunk instanceof Uint8Array)||chunk.length>length-position)corrupt();
   bytes.set(chunk,position);position+=chunk.length;
  }
  if(position!==length)corrupt();
  return bytes;
 };
 const start=readSqliteVarint(await read(0,Math.min(9,record.size)),0);
 const headerSize=Number(start.value);
 if(!Number.isSafeInteger(headerSize)||headerSize<start.end||headerSize>record.size||headerSize>9*(maxColumns+1))corrupt();
 const header=await read(0,headerSize),values:SqliteRecordValue[]=[];
 let position=start.end,offset=headerSize;
 while(position<headerSize){
  if(values.length===maxColumns)throw new FsError('EFBIG',{message:'SQLite record exceeds column budget'});
  const serial=readSqliteVarint(header,position);position=serial.end;
  const type=serial.value;
  if(type===10n||type===11n)corrupt();
  if(type===0n){values.push(null);continue;}
  if(type===8n||type===9n){values.push(type-8n);continue;}
  const size=type>=12n?Number((type-12n)/2n):[0,1,2,3,4,6,8,8][Number(type)]!;
  if(!Number.isSafeInteger(size)||size<0||size>record.size-offset)corrupt();
  if(type>=12n){
   const fieldOffset=offset;
   values.push({type:type%2n?'text':'blob',size,bytes:{[Symbol.asyncIterator](){return record.bytes(fieldOffset,size)[Symbol.asyncIterator]();}}});
  }else{
   const bytes=await read(offset,size);
   if(type===7n)values.push(new DataView(bytes.buffer,bytes.byteOffset,8).getFloat64(0));
   else{
    let integer=0n;for(const byte of bytes)integer=(integer<<8n)|BigInt(byte);
    values.push(BigInt.asIntN(size*8,integer));
   }
  }
  offset+=size;
 }
 if(position!==headerSize||offset!==record.size)corrupt();
 return values;
}
