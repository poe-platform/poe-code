import { writeSqliteVarint as varint } from './sqlite-varint.js';
import {yieldTurn} from 'safe-bash-contracts/yield';
import type {ByteSource} from 'safe-bash-contracts';
import {sqliteSourceChunks} from './sqlite-stream.js';
export interface FtsPosting {term:Uint8Array;rowid:bigint;positionBytes:number;positions:ByteSource}
export interface FtsLeaf {page:number;bytes:Uint8Array;indexTerm?:Uint8Array}
function compare(a:Uint8Array,b:Uint8Array):number{for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]!-b[i]!;return a.length-b.length;}
// Caller owns sorted postings, exact encoded position sizes,
// native structure/docsize/averages, transaction rollback and publication.
export async function* sqliteFtsLeaves(records:AsyncIterable<FtsPosting>,signal:AbortSignal):AsyncIterable<FtsLeaf>{
 let pending:number[]=[],footer:number[]=[],previousTerm=new Uint8Array(),previousRow=0n;
 let steps=0,positionSteps=0;
 let page=0,lastTermOffset=0,firstRow=true,rowOffset=0,indexTerm:Uint8Array|undefined;
 const flush=():FtsLeaf=>{
  if(++page>0x7fffffff)throw new RangeError('FTS page count out of range');
  const end=pending.length+4;
  const result={page,bytes:Uint8Array.from([rowOffset>>8,rowOffset&255,end>>8,end&255,...pending,...footer]),...(indexTerm?{indexTerm}:{})};
  pending=[];footer=[];lastTermOffset=0;firstRow=true;rowOffset=0;indexTerm=undefined;return result;
 };
 for await(const record of sqliteSourceChunks(records,signal)){
  if(++steps%64===0)await yieldTurn(signal);
  signal.throwIfAborted();
  const {term:inputTerm,rowid,positionBytes,positions}=record;
  if(!(inputTerm instanceof Uint8Array)||!inputTerm.length||inputTerm.length>32768)throw new RangeError('Invalid FTS term');
  if(rowid<-(1n<<63n)||rowid>=(1n<<63n))throw new RangeError('Invalid FTS rowid');
  if(!Number.isSafeInteger(positionBytes)||positionBytes<=0)throw new RangeError('Invalid FTS position length');
  const term=new Uint8Array(inputTerm.length+1);term[0]=48;term.set(inputTerm,1);
  const order=compare(term,previousTerm),newTerm=order!==0;
  if(order<0||!newTerm&&rowid<=previousRow)throw new RangeError('FTS postings must be strictly sorted');
  if(newTerm){
   if(pending.length&&pending.length+footer.length+term.length+24>=4000)yield flush();
   const first=footer.length===0,offset=pending.length+4;
   if(first)indexTerm=page===0?new Uint8Array():term.slice();
   footer.push(...varint(BigInt(offset-lastTermOffset)));lastTermOffset=offset;
   let common=0;if(!first)while(common<Math.min(previousTerm.length,term.length)&&previousTerm[common]===term[common])common++;
   pending.push(...(first?[]:varint(BigInt(common))),...varint(BigInt(term.length-common)),...term.subarray(common));
   previousTerm=term;firstRow=false;
  }else if(pending.length+footer.length+22>=4000)yield flush();
  if(firstRow)rowOffset=pending.length+4;
  pending.push(...varint(newTerm||firstRow?BigInt.asUintN(64,rowid):rowid-previousRow),...varint(BigInt(positionBytes)*2n));
  previousRow=rowid;firstRow=false;
  let received=0,encoded:number[]=[];
  for await(const chunk of sqliteSourceChunks(positions,signal)){
   if(++steps%64===0)await yieldTurn(signal);
   if(!(chunk instanceof Uint8Array))throw new TypeError('FTS positions must yield bytes');
   if(received+chunk.length>positionBytes)throw new RangeError('FTS position length mismatch');
   received+=chunk.length;
   for(const byte of chunk){
    if(++positionSteps%16384===0)await yieldTurn(signal);
    signal.throwIfAborted();encoded.push(byte);
    if(byte<128||encoded.length===9){
     if(pending.length+footer.length+encoded.length+4>4000)yield flush();
     pending.push(...encoded);encoded=[];
    }
   }
  }
  if(received!==positionBytes||encoded.length)throw new RangeError('FTS position length mismatch or incomplete varint');
 }
 signal.throwIfAborted();if(pending.length)yield flush();
}
