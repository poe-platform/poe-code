import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {parseBackedJson} from "./backed-json-parser.js";
import {applyRetainedLuaFilter} from "./lua-retained-filter.js";
import {LuaError} from "./lua-error.js";
import {LuaStrings} from "./lua-strings.js";
import {LuaStorage} from "./lua-storage.js";
import {PandocError} from "./errors.js";
import type {AdapterContext,FilterRequest,JsonFilterStreams} from "./types.js";
import type {LuaFilterOptions,LuaScriptLoader,LuaStreamFilterOptions} from "./lua-filters.js";

export async function applyLuaStream(load:LuaScriptLoader | LuaFilterOptions | LuaStreamFilterOptions,streams:JsonFilterStreams,request:FilterRequest,context:AdapterContext & {readonly to:string}):Promise<void> {
  if(request.kind!=="lua")throw new PandocError("E_CAPABILITY","convert","This capability supports Lua filters only");
  const working=context.workingFiles;
  if(!working)throw new PandocError("E_CAPABILITY","convert","Streaming Lua filters require caller workingFiles");
  const cache=working.cacheBytes??1048576;
  if(!Number.isSafeInteger(cache) || cache<16384 || cache%16384 || !working.directory.startsWith("/"))throw new PandocError("E_OPTION","convert","Invalid Lua working storage options");
  const signal=context.signal??streams.signal,cooperate=(units?:number)=>context.cooperate(units);
  const owner={fs:working.fs,cwd:working.directory,env:{},signal};
  const stores=Array.from({length:3},()=>new PagedStorage(owner,cache/16384));
  const input=new BackedJson(stores[0]!,cooperate),output=new BackedJson(stores[1]!,cooperate),scratch=stores[2]!;
  let failure:{reason:unknown} | undefined;
  const operation=(async()=>{
    const text=(async function*(){
      const decoder=new TextDecoder("utf-8",{fatal:true});
      for await(const bytes of streams.stdin) {
        if(!(bytes instanceof Uint8Array))throw new PandocError("E_IO","convert","Lua filter input must be bytes");
        for(let offset=0;offset<bytes.length;offset+=8192) {
          await cooperate();
          yield decoder.decode(bytes.subarray(offset,offset+8192),{stream:true});
        }
      }
      yield decoder.decode();
    })();
    await parseBackedJson(text,input,scratch,cooperate,(offset,message)=>{throw new PandocError("E_AST","convert",message,"json",`$@${offset}`);});
    const streamed=typeof load!=="function" && Boolean(load.readStream);
    let supplied:Uint8Array | undefined;
    if(!streamed){
      supplied=await (typeof load==="function"?load:load.readFile!)(request.path,signal);
      if(!(supplied instanceof Uint8Array))throw new PandocError("E_IO","convert","Lua filter source must be bytes");
      context.charge("inputBytes",supplied.length);context.charge("retainedBytes",supplied.length);
    }
    const source=(async function*(){
      if(streamed)yield* (load as LuaStreamFilterOptions).readStream(request.path,signal);
      else yield supplied!;
    })();
    try {await applyRetainedLuaFilter(input,output,source,scratch,context,context.to,request.path,typeof load==="function",!streamed);}
    catch(error) {
      if(!(error instanceof LuaError))throw error;
      const heap=new LuaStorage(scratch,cooperate),value=error.value;
      const message=(async function*(){
        if(error.source && error.line!==undefined) {
          const size=await heap.byteLength(error.source),head=await heap.readBytes(error.source,0,Math.min(size,61));
          const encoder=new TextEncoder();
          if(head[0]===61)yield head.subarray(1);
          else if(head[0]===64) {
            if(size<=60)yield head.subarray(1);
            else {yield encoder.encode("...");yield await heap.readBytes(error.source,size-57,57);}
          } else {
            yield encoder.encode('[string "');
            const newline=head.indexOf(10),short=size<45 && newline===-1;
            yield head.subarray(0,short?size:Math.min(newline===-1?size:newline,45));
            if(!short)yield encoder.encode("...");
            yield encoder.encode('"]');
          }
          yield encoder.encode(`:${error.line}: `);
        }
        if(typeof value==="object" && value.kind==="string")yield* heap.bytes(value);
        else if(typeof value==="number" || typeof value==="object" && value.kind==="integer")
          yield* heap.bytes(await new LuaStrings(heap).concat((async function*(){yield value;})()));
        else yield new TextEncoder().encode("Lua filter execution failed");
      })();
      const rendered=new PandocError(typeof load==="function" && error.code==="E_AST" && error.scriptFailure?"E_IO":error.code,"convert","Lua filter execution failed");
      if(typeof load!=="function" && load.onError)await load.onError(rendered,message);
      else {
        const decoder=new TextDecoder();let text="";
        for await(const bytes of message){context.charge("retainedBytes",bytes.length*2);text+=decoder.decode(bytes,{stream:true});}
        rendered.message=text+decoder.decode();
      }
      throw rendered;
    }
    for await(const bytes of output.chunks())await streams.stdout.write(bytes);
  })();
  // ExecutionContext may cancel its capability race before this promise settles.
  // Keep backing files alive until the in-flight VM has observed cancellation.
  const completion=(async()=>{
    try {await operation;}catch(reason){failure={reason};}
    for(const store of stores)try{await store.close();}catch(reason){failure??={reason};}
    if(failure)throw failure.reason;
  })();
  const release=context.onClose?.(async()=>{await completion.catch(()=>{});});
  try {await completion;}finally{release?.();}
}
