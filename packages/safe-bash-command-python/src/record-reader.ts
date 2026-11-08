
/** Sequential transport keeps only an encoded window; backward reads replay.
 * The pure JSON iterator owns no resources. Session retirement aborts its signal. */
export function createPythonRecordReader<T>(encode:(row:T)=>AsyncIterable<Uint8Array>){
 let source:AsyncIterator<Uint8Array>|undefined,row:T|undefined;
 let text='',previous='',position=0,tail:Promise<unknown>=Promise.resolve();
 return {
  read(nextRow:T,offset:number):Promise<string>{
   const work=tail.then(async()=>{
    if(row===nextRow&&offset===position-1&&previous){text=previous+text;position--;}
    if(row!==nextRow||offset<position){source=undefined;position=0;text=previous='';row=nextRow;}
    source??=encode(nextRow)[Symbol.asyncIterator]();
    const decoder=new TextDecoder();
    while(true){
     if(position<offset){const skip=Math.min(offset-position,text.length);if(skip)previous=text[skip-1]!;text=text.slice(skip);position+=skip;}
     if(text.length>=8192)break;
     const next=await source.next();
     if(next.done)break;
     text+=decoder.decode(next.value);
    }
    const result=text.slice(0,8192);previous=result.at(-1)??previous;text=text.slice(result.length);position+=result.length;
    return result;
   });
   tail=work.catch(()=>{});return work;
  },
  async close(){await tail;source=undefined;text=previous='';row=undefined;},
 };
}
