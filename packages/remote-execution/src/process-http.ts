import {parseWireJson} from './wire-json.js';
import {binaryContentType,decodeFrames} from './binary.js';
import {RemoteExecutionError,UnrecoverableTransportError,type SessionIdentity} from './client.js';
import type {ProcessConnection} from './process.js';
import {validateWire} from './wire-validation.js';
import type {Outcome} from './wire.generated.js';

export interface ProcessHttpIdentity extends SessionIdentity {jobId:string}
function path(identity:ProcessHttpIdentity){return `/v1/sessions/${encodeURIComponent(identity.sessionId)}/jobs/${encodeURIComponent(identity.jobId)}/process`;}
async function bytes(body:ReadableStream<Uint8Array>|null,max:number,signal:AbortSignal){
 if(!body)throw new TypeError('Missing process document');
 const reader=body.getReader();const chunks:Uint8Array[]=[];let size=0;
 const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  signal.throwIfAborted();for(;;){const result=await reader.read();signal.throwIfAborted();if(result.done)break;
   if(!(result.value instanceof Uint8Array))throw new TypeError('Process document bytes required');
   const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(result.value) as number;
   if(length>max-size)throw new TypeError('Process document exceeds admission');
   const owned=new Uint8Array(length);Uint8Array.prototype.set.call(owned,result.value);
   chunks.push(owned);size+=length;
  }
  const value=new Uint8Array(size);let offset=0;for(const chunk of chunks){value.set(chunk,offset);offset+=chunk.length;}return value;
 }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function document(body:ReadableStream<Uint8Array>|null,signal:AbortSignal){return parseWireJson(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(body,4096,signal))) as unknown;}
function record(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new TypeError('Invalid process control');
}
function integer(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>1024)throw new TypeError('Invalid process stream');return value as number;}
function offset(value:unknown):bigint{validateWire('Uint64',value);return BigInt(value as string);}

/** Mount only for a job admitted by the authenticated isolation/session owner.
 * There is no executable, argv, descriptor acquisition or launch endpoint.
 * authorize must validate current principal/session/job authority on every call.
 * The owning job retains lease expiry, disposal and delegate reaping authority. */
export function createProcessHttpHandler(options:{identity:ProcessHttpIdentity;connection:ProcessConnection;authorize(request:Request):Promise<boolean>;maxRequests:number}){
 options={...options};
 if(!Number.isSafeInteger(options.maxRequests)||options.maxRequests<1)throw new TypeError('Invalid process request bound');
 const identity={...options.identity};const prefix=path(identity);const connection=options.connection;
 const maxRequests=options.maxRequests;
 const stdinKind=connection.stdinKind;const maxFrameBytes=connection.maxFrameBytes;
 const suppliedInputs=connection.inputChannels??(stdinKind==='pipe'?[1]:[]);
 const suppliedOutputs=connection.outputs;
 if(!Array.isArray(suppliedInputs)||suppliedInputs.length>64||suppliedOutputs.size>64
  ||!['pipe','descriptor'].includes(stdinKind)||!Number.isSafeInteger(maxFrameBytes)||maxFrameBytes<1||maxFrameBytes>1048576)throw new TypeError('Invalid process lane capacity');
 // Lane identity and credit are fixed admission authority, including across
 // asynchronous authorization. A mutable connector cannot replace a borrowed
 // stream or enlarge a frame allocation after the handler is mounted.
 const inputs=Array.from({length:suppliedInputs.length},(_,index)=>{
  if(!Object.hasOwn(suppliedInputs,index))throw new TypeError('Invalid process lane capacity');
  return integer(suppliedInputs[index]);
 });
 const outputs=new Map(suppliedOutputs);
 if(new Set(inputs).size!==inputs.length||inputs.includes(2)||inputs.includes(3)
  ||inputs.includes(1)!==(stdinKind==='pipe')||outputs.has(1)||!outputs.has(2)||!outputs.has(3)||outputs.size>64)throw new TypeError('Invalid process lane capacity');
 const lanes=[...inputs.map(channel=>'POST:'+channel+'/frames'),...[...outputs.keys()].flatMap(channel=>{
  integer(channel);return ['GET:'+channel+'/frames','POST:'+channel+'/ack','POST:'+channel+'/close-output'];
 })];
 // Fixed admitted lane budgets prevent a blocked native descriptor from
 // starving another descriptor. Observation and control have independent
 // bounds too; unadmitted routes cannot allocate new capacity entries.
 const active=new Map(['data','control','outcome',...lanes].map(key=>[key,0]));
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Execution-Epoch':identity.epoch,'Cache-Control':'no-store'}});
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);
  const route=url.pathname.startsWith(prefix+'/')?url.pathname.slice(prefix.length+1).split('/'):[];
  const control=request.method==='POST'&&!url.search&&(route.length===1&&['close','signal'].includes(route[0]!)
   ||route.length===2&&['ack','close-output'].includes(route[1]!));
  const outcome=request.method==='GET'&&!url.search&&route.length===1&&route[0]==='outcome';
  const lane=route.length===2?request.method+':'+route.join('/'):undefined;
  const capacity=lane&&active.has(lane)?lane:control?'control':outcome?'outcome':'data';
  if(active.get(capacity)!>=maxRequests)return json({code:'admissionBound'},429);active.set(capacity,active.get(capacity)!+1);
  try{
   if(!await options.authorize(request))return json({code:'authorization'},403);
   if(request.headers.get('Execution-Protocol')!=='1')return json({code:'protocol'},400);
   if(request.headers.get('Execution-Epoch')!==identity.epoch)return json({code:'epochLost'},410);
   if(url.search||!url.pathname.startsWith(prefix+'/'))return json({code:'notFound'},404);
   request.signal.throwIfAborted();
   if(route.length===1&&route[0]==='metadata'&&request.method==='GET')return json({stdinKind,maxFrameBytes,inputChannels:inputs,outputChannels:[...outputs.keys()]});
   if(route.length===1&&route[0]==='outcome'&&request.method==='GET'){
    let abort!:()=>void;const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(request.signal.reason);request.signal.addEventListener('abort',abort,{once:true});});
    try{return json(await Promise.race([connection.outcome,canceled]));}finally{request.signal.removeEventListener('abort',abort);}
   }
   if(route.length===1&&route[0]==='close'&&request.method==='POST'){await connection.close();return json({closed:true});}
   if(route.length===1&&route[0]==='signal'&&request.method==='POST'){
    const value=await document(request.body,request.signal);record(value,['name',...(value&&typeof value==='object'&&Object.hasOwn(value,'number')?['number']:[]),...(value&&typeof value==='object'&&Object.hasOwn(value,'target')?['target']:[])]);
    if(typeof value.name!=='string'||!value.name||value.name.includes('\0')||value.number!==undefined&&(!Number.isSafeInteger(value.number)||Number(value.number)<1||Number(value.number)>255)||value.target!==undefined&&value.target!=='process-group'||!connection.signal)throw new TypeError('Invalid admitted signal');
    if(!await options.authorize(request))return json({code:'authorization'},403);
    request.signal.throwIfAborted();
    await connection.signal(value.name,value.number as number|undefined,value.target as 'process-group'|undefined);return json({accepted:true});
   }
   if(route.length!==2)return json({code:'notFound'},404);
   const channel=integer(Number(route[0]));if(String(channel)!==route[0])throw new TypeError('Invalid process stream');
   // The authenticated connection's directional lanes are the descriptor
   // authority. A bounded control slot does not admit an arbitrary stream ID.
   if(!lane||!active.has(lane))return json({code:'notFound'},404);
   if(route[1]==='frames'&&request.method==='GET'){
    const source=outputs.get(channel);if(!source)return json({code:'notFound'},404);if(source.locked)return json({code:'consumerBusy'},409);
    // Network body consumption never returns native credit. Only /ack does.
    let reader:ReadableStreamDefaultReader<Uint8Array>;let released:Promise<void>|undefined;
    const abort=()=>{void release(request.signal.reason).catch(()=>{});};
    request.signal.addEventListener('abort',abort,{once:true});
    try{reader=source.getReader();}catch(cause){request.signal.removeEventListener('abort',abort);throw cause;}
    function release(cause?:unknown):Promise<void>{
     released??=(async()=>{request.signal.removeEventListener('abort',abort);try{await reader.cancel(cause);}finally{reader.releaseLock();}})();
     return released;
    }
    const body=new ReadableStream<Uint8Array>({async pull(controller){try{
     request.signal.throwIfAborted();if(!await options.authorize(request))throw new Error('Process stream authority expired');
     const result=await reader.read();request.signal.throwIfAborted();if(!await options.authorize(request))throw new Error('Process stream authority expired');
     if(result.done){await release();controller.close();}else controller.enqueue(result.value);
    }catch(cause){await release(cause);controller.error(cause);}},cancel:release},{highWaterMark:0});
    return new Response(body,{headers:{'Content-Type':binaryContentType,'Execution-Epoch':identity.epoch,'Cache-Control':'no-store','X-Accel-Buffering':'no'}});
   }
   if(route[1]==='frames'&&request.method==='POST'){
    if(request.headers.get('Content-Type')!==binaryContentType)throw new TypeError('Binary process frame required');
    const expected=offset(request.headers.get('Execution-Offset'));
    const frame=await bytes(request.body,40+maxFrameBytes,request.signal);
    if(!await options.authorize(request))return json({code:'authorization'},403);
    return json({offset:String(await connection.send(channel,frame,expected,request.signal))});
   }
   if(route[1]==='ack'&&request.method==='POST'){
    const value=await document(request.body,request.signal);record(value,['sequence','offset']);
    const sequence=offset(value.sequence);const position=offset(value.offset);
    if(!await options.authorize(request))return json({code:'authorization'},403);
    request.signal.throwIfAborted();
    await connection.ack(channel,sequence,position);return json({accepted:true});
   }
   if(route[1]==='close-output'&&request.method==='POST'){
    const value=await document(request.body,request.signal);record(value,['code']);if(value.code!=='EPIPE')throw new TypeError('Invalid destination closure');
    if(!await options.authorize(request))return json({code:'authorization'},403);
    request.signal.throwIfAborted();
    await connection.closeOutput(channel,Object.assign(new Error('Remote destination closed'),{code:'EPIPE'}));return json({accepted:true});
   }
   return json({code:'notFound'},404);
  }catch(cause){return json({code:(cause as {code?:string})?.code==='EPIPE'?'EPIPE':'processOperationFailed'},(cause as {code?:string})?.code==='EPIPE'?409:503);}finally{active.set(capacity,active.get(capacity)!-1);}
 };
}

/** Portable paired HTTPS transport. Frame credits reflect native acceptance and
 * canonical destination delivery; fetch/WebSocket buffering supplies no credit.
 * Ack/cleanup use independent bounded requests so invocation cancellation cannot
 * erase effects already accepted by an owned destination. */
export async function connectHttpProcess(options:{baseUrl:string;identity:ProcessHttpIdentity;token():Promise<string>;fetch?:typeof globalThis.fetch;requestTimeoutMs?:number},signal:AbortSignal):Promise<ProcessConnection>{
 options={...options};
 const origin=new URL(options.baseUrl);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new TypeError('An authenticated HTTPS origin is required');
 const identity={...options.identity};const prefix=path(identity);const transport=options.fetch??globalThis.fetch;const timeout=options.requestTimeoutMs??5000;
 const owner=new AbortController();const lifetime=AbortSignal.any([signal,owner.signal]);let finalized=false;
 let acquisitionDispatched=false;
 const outputWork=new Set<Promise<void>>();const inputWork=new Set<Promise<unknown>>();const deliveries=new Set<Promise<unknown>>();
 const activeControls=new Set<string>();
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>2147483647)throw new TypeError('Invalid process request timeout');
 async function request(route:string,method:string,body?:BodyInit,borrowed?:AbortSignal,binary=false,expected?:bigint){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new Error('Process request timed out')),timeout);
  const bounded=controller.signal;const credentialSignal=borrowed?AbortSignal.any([borrowed,bounded]):bounded;
  const persistent=method==='GET'&&(route==='outcome'||route.endsWith('/frames'));
  const requestSignal=persistent?(borrowed??new AbortController().signal):credentialSignal;
  requestSignal.throwIfAborted();
  const credential=Promise.resolve().then(()=>options.token());void credential.catch(()=>{});
  let abort!:()=>void;const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(credentialSignal.reason);credentialSignal.addEventListener('abort',abort,{once:true});});
  let token:string;try{credentialSignal.throwIfAborted();token=await Promise.race([credential,canceled]);}catch(cause){clearTimeout(timer);if(borrowed?.aborted)throw borrowed.reason;throw new RemoteExecutionError('Process credentials unavailable','notAccepted',identity,401,{cause});}finally{credentialSignal.removeEventListener('abort',abort);}
  if(persistent)clearTimeout(timer);
  requestSignal.throwIfAborted();const headers=new Headers({'Authorization':'Bearer '+token,'Execution-Epoch':identity.epoch,'Execution-Protocol':'1'});
  if(body!==undefined)headers.set('Content-Type',binary?binaryContentType:'application/json');if(expected!==undefined)headers.set('Execution-Offset',String(expected));
  let response:Response;
  try{
   if(route==='metadata')acquisitionDispatched=true;
   response=await transport(new URL(prefix+'/'+route,origin),{method,body,headers,signal:requestSignal,redirect:'error'});
  }
  catch(cause){clearTimeout(timer);if(borrowed?.aborted)throw borrowed.reason;throw new RemoteExecutionError('Process transport interrupted','unknown',identity,undefined,{cause});}
  if(!response.ok||response.headers.get('Execution-Epoch')!==identity.epoch){
   if(route==='metadata')acquisitionDispatched=false;
   try{
    if(response.status===409&&response.headers.get('Execution-Epoch')===identity.epoch&&binary){
     const error=await document(response.body,requestSignal);record(error,['code']);
     if(error.code==='EPIPE')throw Object.assign(new Error('Native process input closed'),{code:'EPIPE'});
    }
    if(response.status===410 || response.ok && response.headers.get('Execution-Epoch')!==identity.epoch)throw new UnrecoverableTransportError(identity);
    throw new RemoteExecutionError('Process transport admission failed','unknown',identity,response.status);
   }finally{clearTimeout(timer);await response.body?.cancel().catch(()=>{});}
  }
  return{response,requestSignal,dispose(){clearTimeout(timer);}};
 }
 async function control(route:string,method:string,body?:unknown,borrowed?:AbortSignal){
  // Admit before credentials or dispatch. Each destination's credit and closure
  // have separate slots; neither competes with signals or invocation retirement.
  if(method==='POST'){
   if(activeControls.has(route))throw new TypeError('Process control admission limit');
   activeControls.add(route);
  }
  try{const result=await request(route,method,body===undefined?undefined:JSON.stringify(body),borrowed);try{
  const value=await document(result.response.body,result.requestSignal);
  if(route==='close'){record(value,['closed']);if(value.closed!==true)throw new TypeError('Missing process retirement acknowledgement');}
  else if(method==='POST'){record(value,['accepted']);if(value.accepted!==true)throw new TypeError('Missing process control acknowledgement');}
  return value;
 }catch(cause){if(borrowed?.aborted)throw borrowed.reason;throw new RemoteExecutionError('Process control delivery interrupted','unknown',identity,undefined,{cause});}finally{result.dispose();}
  }finally{if(method==='POST')activeControls.delete(route);}
 }
 try {
 const metadata=await control('metadata','GET',undefined,lifetime);
 record(metadata,['stdinKind','maxFrameBytes','inputChannels','outputChannels']);
 if(!['pipe','descriptor'].includes(metadata.stdinKind as string)||!Number.isSafeInteger(metadata.maxFrameBytes)||Number(metadata.maxFrameBytes)<1||Number(metadata.maxFrameBytes)>1048576||!Array.isArray(metadata.inputChannels)||!Array.isArray(metadata.outputChannels))throw new TypeError('Invalid process lane admission');
 if(metadata.inputChannels.length>64||metadata.outputChannels.length>64)throw new TypeError('Invalid process lane admission');
 const inputs=Object.freeze(metadata.inputChannels.map(integer));const channels=metadata.outputChannels.map(integer);
 if(new Set(inputs).size!==inputs.length||new Set(channels).size!==channels.length||!channels.includes(2)||!channels.includes(3)||channels.includes(1)||inputs.includes(2)||inputs.includes(3)||inputs.includes(1)!==(metadata.stdinKind==='pipe'))throw new TypeError('Invalid process lane admission');
 const inputBusy=new Set<number>();const inputEnded=new Set<number>();
 const inputSequences=new Map<number,bigint>();const inputOffsets=new Map<number,bigint>();
 const inputFailures=new Map<number,unknown>();
 const readers=new Set<ReadableStreamDefaultReader<Uint8Array>>();
 const outputs=new Map(channels.map(channel=>{let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;return[channel,new ReadableStream<Uint8Array>({
  async pull(controller){
   const operation=(async()=>{try{
    lifetime.throwIfAborted();
    if(!reader){const {response}=await request(channel+'/frames','GET',undefined,lifetime);
     if(finalized||lifetime.aborted){await response.body?.cancel().catch(()=>{});lifetime.throwIfAborted();throw new Error('Process transport finalized');}
     if(response.headers.get('Content-Type')!==binaryContentType||!response.body){await response.body?.cancel();throw new TypeError('Invalid process binary response');}reader=response.body.getReader();readers.add(reader);
    }
    const result=await reader.read();lifetime.throwIfAborted();if(result.done){readers.delete(reader);reader.releaseLock();controller.close();}else controller.enqueue(result.value);
   }catch(cause){
    // A failed body cannot be resumed through this reader. Retire its local
    // ownership without mistaking reader cancellation failure for group loss.
    if(reader){readers.delete(reader);await reader.cancel(cause).catch(()=>{});reader.releaseLock();reader=undefined;}
    controller.error(lifetime.aborted?lifetime.reason:cause instanceof RemoteExecutionError?cause:new RemoteExecutionError('Process output delivery interrupted','unknown',identity,undefined,{cause}));
   }})();
   outputWork.add(operation);try{await operation;}finally{outputWork.delete(operation);}
  },
  async cancel(cause){if(reader){
   // A blocked pull can retire/reset the shared reader while cancellation
   // settles. Release the same acquired reader without replacing its failure.
   const retiring=reader;readers.delete(retiring);
   try{await retiring.cancel(cause);}finally{retiring.releaseLock();}
  }},
 },{highWaterMark:0})]as const;}));
 const outcome=control('outcome','GET',undefined,lifetime).then(value=>{validateWire('Outcome',value);return value as Outcome;});void outcome.catch(()=>{});
 let closing:Promise<void>|undefined;
 return{stdinKind:metadata.stdinKind as 'pipe'|'descriptor',maxFrameBytes:metadata.maxFrameBytes as number,inputChannels:inputs,outputs,outcome,
  async send(channel,frame,expected,caller){
   if(finalized)throw new TypeError('Process transport finalized');
   if(inputFailures.has(channel))throw inputFailures.get(channel);
   const admittedSignal=AbortSignal.any([caller,lifetime]);admittedSignal.throwIfAborted();
   if(!inputs.includes(channel)||inputBusy.has(channel)||inputEnded.has(channel)
    ||!(frame instanceof Uint8Array)
    ||typeof expected!=='bigint'||expected<0n||expected>18446744073709551615n)throw new TypeError('Invalid process input credit');
   // Admit the intrinsic byte span before allocation. Borrowed producers can
   // shadow instance properties; those properties cannot widen lane credit or
   // replace the bytes whose native acceptance we will acknowledge.
   const prototype=Object.getPrototypeOf(Uint8Array.prototype);
   const length=Object.getOwnPropertyDescriptor(prototype,'byteLength')!.get!.call(frame) as number;
   if(length<40||length>40+Number(metadata.maxFrameBytes))throw new TypeError('Invalid process input credit');
   const buffer=Object.getOwnPropertyDescriptor(prototype,'buffer')!.get!.call(frame) as ArrayBuffer;
   const byteOffset=Object.getOwnPropertyDescriptor(prototype,'byteOffset')!.get!.call(frame) as number;
   if(new DataView(buffer,byteOffset,length).getUint32(12)!==length-40)throw new TypeError('Invalid process input credit');
   const owned=new Uint8Array(length);Uint8Array.prototype.set.call(owned,frame);
   frame=owned;inputBusy.add(channel);
   const operation=(async()=>{
    const source=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(frame);controller.close();}});
    let sequence=0n;let ended=false;
    for await(const decoded of decodeFrames(source,{channels:[channel],maxFrameBytes:Number(metadata.maxFrameBytes),maxControlBytes:Number(metadata.maxFrameBytes),firstSequence:inputSequences.get(channel)??1n,offsets:new Map([[channel,inputOffsets.get(channel)??0n]])},admittedSignal)){
     if(decoded.kind==='control'||decoded.correlationId!==0n||decoded.offset+BigInt(decoded.payload.length)!==expected)throw new TypeError('Invalid process input credit');
     sequence=decoded.sequence;ended=decoded.kind==='end';
    }
    try {
    const result=await request(channel+'/frames','POST',frame as BodyInit,admittedSignal,true,expected);
    try{const value=await document(result.response.body,result.requestSignal);record(value,['offset']);const accepted=offset(value.offset);
     if(accepted!==expected)throw new TypeError('Native input credit offset conflict');
     inputSequences.set(channel,sequence+1n);inputOffsets.set(channel,accepted);if(ended)inputEnded.add(channel);return accepted;
    }catch(cause){
     if(admittedSignal.aborted)throw admittedSignal.reason;
     throw cause instanceof RemoteExecutionError?cause:new RemoteExecutionError('Process input receipt interrupted; native acceptance unknown','unknown',identity,undefined,{cause});
    }finally{result.dispose();}
    }catch(cause){
     // A missing native receipt is not authority to repeat a write at the old
     // offset. Retire only this input; siblings retain their independent credit.
     if(!(cause instanceof RemoteExecutionError&&cause.phase==='notAccepted'))inputFailures.set(channel,cause);
     throw cause;
    }
   })();
   inputWork.add(operation);try{return await operation;}finally{inputWork.delete(operation);inputBusy.delete(channel);}
  },
  async ack(channel,sequence,position){
   if(finalized)throw new TypeError('Process transport finalized');
   if(!channels.includes(channel)||typeof sequence!=='bigint'||sequence<1n||sequence>18446744073709551615n
    ||typeof position!=='bigint'||position<0n||position>18446744073709551615n)throw new TypeError('Invalid process output credit');
   const operation=control(channel+'/ack','POST',{sequence:String(sequence),offset:String(position)});deliveries.add(operation);try{await operation;}finally{deliveries.delete(operation);}
  },
  async closeOutput(channel){if(finalized)throw new TypeError('Process transport finalized');if(!channels.includes(channel))throw new TypeError('Invalid process output channel');const operation=control(channel+'/close-output','POST',{code:'EPIPE'});deliveries.add(operation);try{await operation;}finally{deliveries.delete(operation);}},
  async signal(name,number,target){if(finalized)throw new TypeError('Process transport finalized');
   if(typeof name!=='string'||!name||name.includes('\0')||number!==undefined&&(!Number.isSafeInteger(number)||number<1||number>255)
    ||target!==undefined&&target!=='process-group')throw new TypeError('Invalid admitted signal');
   const operation=control('signal','POST',{name,number,target});deliveries.add(operation);try{await operation;}finally{deliveries.delete(operation);}},
  close(){
   if(!closing){
    finalized=true;owner.abort(new Error('Process transport finalized'));
    closing=(async()=>{
     const delivered=await Promise.allSettled([...deliveries]);
     const results=await Promise.allSettled([control('close','POST'),outcome.catch(()=>{}),...inputWork,...outputWork,...[...readers].map(async reader=>{try{await reader.cancel();}finally{reader.releaseLock();}})]);
     readers.clear();const failures=[...delivered,...results].filter((result):result is PromiseRejectedResult=>result.status==='rejected'&&result.reason!==owner.signal.reason&&result.reason!==signal.reason);if(failures.length)throw new RemoteExecutionError('Remote process retirement could not be confirmed','unknown',identity,undefined,{cause:new AggregateError(failures.map(result=>result.reason),'Remote process retirement failed')});
    })();
    void closing.catch(()=>{});
   }
   return closing;
  },
 };
 }catch(cause){
  // Own dispatched acquisition through an interrupted or late response. An
  // explicit admission/epoch rejection or failure before credential dispatch
  // supplies no authority to retire the invocation.
  if(acquisitionDispatched)try{await control('close','POST');}catch(cleanup){throw new AggregateError([cause,cleanup],'Process acquisition and cleanup failed',{cause});}
  throw cause;
 }
}
