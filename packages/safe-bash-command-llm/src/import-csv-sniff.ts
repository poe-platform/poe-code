import {sniff,decodeSniffUtf8} from 'safe-bash-csv-engine/sniffer';
import {sourceBytes} from './request-source.js';
import {FsError} from 'safe-bash-contracts';

/** Match the reference's 4096-byte BufferedReader peek without consuming the
 * import. Keep a borrowed tail only until it has been replayed downstream. */
export async function sniffCsvInput(input:AsyncIterable<Uint8Array>,signal:AbortSignal){
 const iterator=sourceBytes(input,signal)[Symbol.asyncIterator]();
 const prefix=new Uint8Array(4096);let length=0,tail:Uint8Array|undefined,ended=false;
 let closing:Promise<void>|undefined;
 const close=()=>closing??=(async()=>{try{await iterator.return?.();}finally{tail=undefined;}})();
 const check=()=>{signal.throwIfAborted();if(closing)throw new FsError('EBADF',{message:'CSV sniff input is closed'});};
 try{
  while(length<prefix.length){
   const next=await iterator.next();if(next.done){ended=true;break;}
   const count=Math.min(prefix.length-length,next.value.length);prefix.set(next.value.subarray(0,count),length);length+=count;
   if(count<next.value.length){tail=next.value.subarray(count);break;}
  }
  const whitespace=(byte:number)=>byte===32||byte>=9&&byte<=13;
  let start=0,end=length;while(start<end&&whitespace(prefix[start]!))start++;while(end>start&&whitespace(prefix[end-1]!))end--;
  if(prefix[start]===91||prefix[start]===123)throw new Error('Expected CSV or TSV input');
  const detected=sniff(decodeSniffUtf8(prefix.subarray(start,end),true,signal),()=>signal.throwIfAborted(),'python39');
  if(!detected)throw new Error('Could not determine delimiter');
  let consumed=false;
  return {dialect:{delimiter:detected.delimiter,quote:detected.quotechar,doubleQuote:detected.doublequote,skipInitialSpace:detected.skipinitialspace},close,bytes:{async *[Symbol.asyncIterator](){
   check();if(consumed)throw new FsError('EBADF',{message:'CSV sniff input is already consumed'});consumed=true;
   try{if(length)yield prefix.subarray(0,length);check();if(tail){yield tail;tail=undefined;}while(!ended){check();const next=await iterator.next();check();if(next.done){ended=true;break;}yield next.value;}}
   finally{await close();}
  }}};
 }catch(error){await close();throw error;}
}
