import {serializeLlmJsonValue} from 'safe-bash-command-llm';
import type {PythonPackageRecord} from './manifest.js';

/** Sequential transport keeps only an encoded window; backward reads replay.
 * The pure JSON iterator owns no resources. Session retirement aborts its signal. */
export function createPythonRecordReader(signal:AbortSignal){
 let source:AsyncIterator<Uint8Array>|undefined,row:PythonPackageRecord|undefined;
 let text='',position=0,tail:Promise<unknown>=Promise.resolve();
 return {
  read(nextRow:PythonPackageRecord,offset:number):Promise<string>{
   const work=tail.then(async()=>{
    if(row!==nextRow||offset<position){source=undefined;position=0;text='';row=nextRow;}
    source??=serializeLlmJsonValue(nextRow.length===5?[...nextRow,null]:nextRow,signal)[Symbol.asyncIterator]();
    const decoder=new TextDecoder();
    while(true){
     if(position<offset){const skip=Math.min(offset-position,text.length);text=text.slice(skip);position+=skip;}
     if(text.length>=8192)break;
     const next=await source.next();
     if(next.done)break;
     text+=decoder.decode(next.value);
    }
    const result=text.slice(0,8192);text=text.slice(result.length);position+=result.length;
    return result;
   });
   tail=work.catch(()=>{});return work;
  },
  async close(){await tail;source=undefined;text='';row=undefined;},
 };
}
