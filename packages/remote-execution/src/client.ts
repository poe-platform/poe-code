import {parseWireJson} from './wire-json.js';
import {validateDependencyManifest, validateDependencyMaterialization, validateManifestInvocation, type DependencyManifest, type DependencyMaterializeRequest, type DependencyMaterialization} from './protocol.js';
import { retrieveOutputs, type OutputDestination, type OutputTransferCursor, type OutputFreshness } from './output-retrieval.js';
import { binaryContentType, decodeFrames, encodeFrame, type BinaryFrame, type BinaryOptions } from './binary.js';
import { validateWire } from './wire-validation.js';
import { uploadRouteId, uploadByteLength, validateUploadState } from './upload-protocol.js';
import type { Failure, DependencyJobRequest, StoredManifest, EffectManifest,FileOpenRequest,FileHandle,FileMetadata,FileListRequest,FileListing,Ack, Blob, CallbackResult, Capabilities, Job, JobRequest, Lane, LaneRequest, Manifest, Materialization, MaterializeRequest, OperationLookup, ReleaseRequest, Session, SessionRequest, Upload, UploadRequest } from './wire.generated.js';
export interface SessionIdentity { sessionId: string; epoch: string }
export interface RecoveryIdentity extends Partial<SessionIdentity> { jobId?: string; operationId?: string; operationKey?: string; laneId?: string; sequence?: string }
export interface StreamCursor extends SessionIdentity {jobId:string;laneId:string;nextSequence:bigint;offsets:Map<number,bigint>;endedChannels:Set<number>;deliveryUnknown?:boolean;deliveryCause?:unknown;busy?:boolean}
// Replacement clients retain receipt evidence through the caller-owned session.
// Origins scope opaque job identities; weak ownership releases disposed sessions.
const jobReceipts=new WeakMap<SessionIdentity,Map<string,Map<string,Job>>>();
// Cursor delivery evidence remains bound even when a new client reconnects.
// Weak ownership does not retain completed streams or caller sinks.
const streamDeliveries=new WeakMap<StreamCursor, {
  origin:string;
  identity:SessionIdentity & {jobId:string;laneId:string};
  nextSequence:bigint;offsets:Map<number,bigint>;endedChannels:Set<number>;
  busy?:boolean;
  consumer?:(frame:BinaryFrame)=>Promise<void>;
  deliveryUnknown?:boolean;deliveryCause?:unknown;
}>();
export class RemoteExecutionError extends Error {
  get category(): Failure['category'] {return this.status===401||this.status===403?'authorization':this.status!==undefined&&this.status>=400&&this.status<500&&this.status!==410?'protocol':'transport';}
  constructor(message: string, readonly phase: 'notAccepted'|'accepted'|'unknown', readonly recovery: RecoveryIdentity, readonly status?: number, options?: ErrorOptions) {super(message,options);this.name='RemoteExecutionError';}
}
/** Validated service diagnostics, kept separate from caller recovery authority. */
export class RemoteServiceError extends RemoteExecutionError {
 readonly failure:Readonly<Failure>;
 constructor(failure:Failure,recovery:RecoveryIdentity,status:number){super(failure.message,failure.phase,recovery,status);this.name='RemoteServiceError';this.failure=Object.freeze(structuredClone(failure));}
 override get category():Failure['category'] {return this.status===401||this.status===403?'authorization':this.failure.category;}
 get code(){return this.failure.code;}
 get path(){return this.failure.path;}
 get syscall(){return this.failure.syscall;}
 get acknowledgedBytes(){return this.failure.acknowledgedBytes;}
}
export class UnrecoverableTransportError extends RemoteExecutionError {
  readonly code='unrecoverable';
  readonly recoveryActions=['inspect','recover-partial-outputs','reauthorize','start-new-invocation'] as const;
  constructor(recovery:RecoveryIdentity,options?:ErrorOptions){super('Retained transport state is unavailable; explicit recovery is required','unknown',recovery,410,options);this.name='UnrecoverableTransportError';}
}
export interface ClientOptions {
  baseUrl: string; token(): Promise<string>; fetch?: typeof globalThis.fetch;
  maxResponseBytes?: number; maxInputBatchBytes?: number;
  /** Separate bounds for binary chunks, upload/blob metadata and credentials. Default 1. */
  maxConcurrentUploads?: number;
}
/** Portable authenticated v1 SDK. Mutations are never automatically retried. A
 * dropped response carries recovery identity; inspect its key before resubmission. */
export function createClient(options: ClientOptions) {
  const base=new URL(options.baseUrl);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new TypeError('An authenticated HTTPS origin is required');
  const transport=options.fetch??globalThis.fetch;const max=options.maxResponseBytes??1048576;const batch=options.maxInputBatchBytes??1048576;
  const concurrency=options.maxConcurrentUploads??1;let activeUploads=0;
  let authenticating=0;
  let activeUploadControls=0;
  let activeUploadRetirements=0;
  for(const n of [max,batch,concurrency])if(!Number.isSafeInteger(n)||n<1)throw new TypeError('Invalid SDK bound');
  function ownerPath(s:SessionIdentity,id:string,owner:'jobs'|'materializations'){return path(s,`${owner}/${encodeURIComponent(id)}`);}
  function path(s:SessionIdentity,suffix=''){return `sessions/${uploadRouteId(s.sessionId)}${suffix?'/'+suffix:''}`;}
  async function response(requestPath:string,method:string,body:BodyInit|undefined,s:SessionIdentity|undefined,key:string|undefined,contentType:string|undefined,signal:AbortSignal|undefined,recovery:RecoveryIdentity,extra?:HeadersInit):Promise<Response>{
    signal?.throwIfAborted();
    if(authenticating>=concurrency)throw new RemoteExecutionError('SDK credential concurrency bound','notAccepted',recovery,429);
    // Credential renewal must not move an admitted request to another session
    // epoch or change the scope against which its receipt is checked.
    s=s?{...s}:undefined;
    const headers=new Headers(extra);
    let token:string;
    let abort!:()=>void;
    const canceled=new Promise<never>((_,reject)=>{
      abort=()=>reject(signal!.reason);
      signal?.addEventListener('abort',abort,{once:true});
    });
    try{
      // Cancellation releases the caller, but uncooperative credential work
      // retains its separate admission slot until settlement.
      authenticating++;
      const credentials=(async()=>{try{return await options.token();}finally{authenticating--;}})();
      token=await Promise.race([credentials,canceled]);
    }
    catch(cause){if(signal?.aborted)throw signal.reason;throw new RemoteExecutionError('Remote credentials unavailable','notAccepted',recovery,401,{cause});}
    finally{signal?.removeEventListener('abort',abort);}
    signal?.throwIfAborted();headers.set('Authorization','Bearer '+token);headers.set('Execution-Protocol','1');
    if(s)headers.set('Execution-Epoch',s.epoch);if(key)headers.set('Idempotency-Key',key);if(contentType)headers.set('Content-Type',contentType);
    let result:Response;
    try{result=await transport(new URL('/v1/'+requestPath,base),{method,body,headers,signal,redirect:'error'});}
    catch(cause){if(signal?.aborted)throw signal.reason;throw new RemoteExecutionError('Transport interrupted; inspect the retained operation before retrying','unknown',recovery,undefined,{cause});}
    if(signal?.aborted){await result.body?.cancel().catch(()=>{});throw signal.reason;}
    if(!result.ok || s&&result.headers.get('Execution-Epoch')!==s.epoch){
      if(!result.ok && result.status!==410 && (!s || result.headers?.get('Execution-Epoch')===s.epoch) && result.headers?.get('Content-Type')?.split(';')[0].trim()==='application/json'){
        let failure:Failure;
        try{failure=await document<Failure>(result,'Failure',recovery,signal);}
        catch(cause){if(signal?.aborted)throw signal.reason;throw new RemoteExecutionError('Remote failure receipt is invalid; inspect the retained operation',result.status>=500?'unknown':'notAccepted',recovery,result.status,{cause});}
        // Native observations belong to job metadata, never to a failed HTTP
        // operation. A provider diagnostic cannot establish tool termination.
        if(failure.category==='native' && result.status!==401 && result.status!==403)throw new RemoteExecutionError('HTTP failure cannot establish a native outcome; inspect the retained invocation','unknown',recovery,502);
        throw new RemoteServiceError(failure,recovery,result.status);
      }
      // Disposal cannot erase an observed authorization failure or replay gap.
      // Preserve its cause within the classified result and recovery identity.
      let disposal:ErrorOptions|undefined;
      try{await result.body?.cancel();}catch(cause){disposal={cause};}
      if(result.status===410 || result.ok)throw new UnrecoverableTransportError(recovery,disposal);
      throw new RemoteExecutionError('Remote request failed',result.status>=500?'unknown':'notAccepted',recovery,result.status,disposal);
    }
    return result;
  }
  async function document<T>(result:Response,schema:string,recovery:RecoveryIdentity={},signal?:AbortSignal):Promise<T>{
    const reader=result.body?.getReader();if(!reader)throw new RemoteExecutionError('Missing remote control document; inspect retained operation','unknown',recovery,502);const chunks:Uint8Array[]=[];let length=0;
    const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{signal?.throwIfAborted();for(;;){let part:ReadableStreamReadResult<Uint8Array>;try{part=await reader.read();}catch(cause){if(signal?.aborted)throw signal.reason;throw new RemoteExecutionError('Remote control delivery interrupted; inspect retained operation','unknown',recovery,undefined,{cause});}signal?.throwIfAborted();if(part.done)break;if(!(part.value instanceof Uint8Array))throw new RemoteExecutionError('Remote control response requires binary bytes; inspect retained operation','unknown',recovery,502);
      // Admit native storage before copying; producer-owned length properties
      // cannot bypass the allocation bound. Empty fragments retain no buffers.
      const span=uploadByteLength(part.value);
      if(span>max-length)throw new RemoteExecutionError('Control response exceeds bound; inspect retained operation','unknown',recovery,502);
      if(span){chunks.push(new Uint8Array(part.value));length+=span;}}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      let value:unknown;
      try{value=parseWireJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validateWire(schema,value);if(schema==='Blob')uploadRouteId((value as Blob).blobId);}
      catch(cause){throw new RemoteExecutionError('Remote control receipt is invalid; inspect retained operation before retrying','unknown',recovery,502,{cause});}
      if(schema==='Upload'){
        try{validateUploadState(value as Upload);}
        catch(cause){throw new RemoteExecutionError('Upload status is inconsistent; inspect before recovery','unknown',recovery,502,{cause});}
      }
      if(schema==='DependencyMaterialization'){
        try{validateDependencyMaterialization(value);}
        catch(cause){throw new RemoteExecutionError('Dependency readiness receipt is inconsistent; inspect before recovery','unknown',recovery,502,{cause});}
      }
      return value as T;
    }finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  async function control<T>(requestPath:string,responseSchema:string,method='GET',body?:unknown,s?:SessionIdentity,key?:string,signal?:AbortSignal,recovery:RecoveryIdentity={},profile?:'dependency-manifest-v1'):Promise<T>{
    const identity={...s,...recovery,...(key?{operationKey:key}:{})};
    signal?.throwIfAborted();
    const uploadControl=responseSchema==='Upload' || responseSchema==='Blob';
    const retirement=uploadControl && method==='DELETE';
    if(uploadControl && (retirement?activeUploadRetirements:activeUploadControls)>=concurrency)throw new RemoteExecutionError('Upload client metadata concurrency bound','notAccepted',identity,429);
    if(retirement)activeUploadRetirements++;
    else if(uploadControl)activeUploadControls++;
    try {
    // Pin the submitted binding before credential acquisition yields. A valid
    // document for a different invocation is not evidence of our acceptance.
    const submitted=responseSchema==='Job' && body && typeof body==='object' && 'buildDigest' in body
      ? {buildDigest:body.buildDigest,invocationId:key}:undefined;
    const result=await response(requestPath,method,body===undefined?undefined:JSON.stringify(body),s,key,body===undefined?undefined:'application/json',signal,identity,profile?{'Execution-Profile':profile}:undefined);
    if(profile && result.headers.get('Execution-Profile')!==profile){await result.body?.cancel().catch(()=>{});throw new RemoteExecutionError('Dependency profile response mismatch','unknown',identity,502);}
    const value=await document<T>(result,responseSchema,identity,signal);
    if(responseSchema==='EffectManifest' && (value as EffectManifest).jobId!==identity.jobId){
      throw new RemoteExecutionError('Effect manifest job binding mismatch; inspect the requested invocation','unknown',identity,502);
    }
    if(responseSchema==='Upload' && method==='POST'){
      try{
        const replay=result.headers.get('Upload-Replayed');
        if(replay!=='true' && replay!=='false')throw new TypeError('Missing or invalid upload creation replay receipt');
        validateUploadState(value as Upload,replay==='true');
      }
      catch(cause){throw new RemoteExecutionError('Upload creation receipt is inconsistent; inspect before recovery','unknown',identity,502,{cause});}
    }
    if(responseSchema==='Job'){
      const job=value as Job;
      if(job.sessionId!==identity.sessionId || job.epoch!==identity.epoch
        || identity.jobId!==undefined && job.jobId!==identity.jobId
        || submitted && (job.buildDigest!==submitted.buildDigest || job.invocationId!==submitted.invocationId)){
        throw new RemoteExecutionError('Job receipt binding mismatch; inspect the original invocation before recovery','unknown',identity,502);
      }
      if(job.outputComplete && (job.state!=='terminal' || job.cleanup!=='complete'
        || !job.jobState || job.jobState.stage!=='io-settled' || job.jobState.outputComplete!==true || job.jobState.cleanup!=='complete')){
        throw new RemoteExecutionError('Job receipt does not establish I/O settlement; inspect the retained invocation','unknown',identity,502);
      }
      if(job.jobState){
        const durable=job.jobState;
        // Admit the durable barrier independently of the live output flag.
        // A malformed settlement must never become retained reconnect evidence.
        if(durable.stage==='io-settled' && (durable.outputComplete!==true || durable.cleanup!=='complete')){
          throw new RemoteExecutionError('Durable I/O settlement requires complete output and cleanup; inspect the retained invocation','unknown',identity,502);
        }
        const observed=durable.processOutcome;
        const confirmed=observed && (observed.kind==='exited' || observed.kind==='signaled'
          || observed.kind==='canceled' && observed.terminationConfirmed);
        if(durable.cancelActed && !durable.cancelRequested){
          throw new RemoteExecutionError('Cancellation action receipt requires a request; inspect the retained invocation','unknown',identity,502);
        }
        // Live observations may lead durable publication, but cannot retract
        // progress already established by that invocation's durable receipt.
        if(BigInt(job.effectBarrier)<BigInt(durable.effectBarrier)
          || durable.cancelRequested===true && !job.cancelRequested
          || durable.outputComplete===true && !job.outputComplete
          || durable.cleanup==='complete' && job.cleanup!=='complete'){
          throw new RemoteExecutionError('Job receipt retracts durable settlement progress; inspect the retained invocation','unknown',identity,502);
        }
        // In-flight effects and cancellation requests can lead persistence.
        // Immutable retention and confirmed native observations cannot disagree,
        // even while output remains incomplete and reconnect is still possible.
        if(Date.parse(job.retainedUntil)!==durable.retainedUntil
          || (durable.stage==='accepted' || durable.stage==='running') && observed
          || (durable.stage==='process-exited' || durable.stage==='io-settled') && !confirmed
          || observed && !confirmed
          || confirmed && job.processOutcome && (Object.keys(job.processOutcome).length!==Object.keys(observed).length
            || Object.entries(observed).some(([field,entry])=>Reflect.get(job.processOutcome!,field)!==entry))){
          throw new RemoteExecutionError('Job receipt contradicts durable native evidence; inspect the retained invocation','unknown',identity,502);
        }
      }
      if(job.outputComplete && job.jobState){
        const durable=job.jobState;
        const observed=durable.processOutcome;
        // A settled native observation has only scalar fields. Compare those
        // fields independently of JSON key order; transport/provider outcomes
        // cannot qualify this barrier. Incomplete inspection may still expose
        // a known process exit alongside an unknown lifecycle outcome.
        const confirmed=observed && (observed.kind==='exited' || observed.kind==='signaled'
          || observed.kind==='canceled' && observed.terminationConfirmed);
        const outcomes=[job.outcome,...(job.processOutcome?[job.processOutcome]:[])];
        if(!confirmed || outcomes.some(outcome=>!outcome
          || Object.keys(outcome).length!==Object.keys(observed).length
          || Object.entries(observed).some(([field,entry])=>Reflect.get(outcome,field)!==entry))
          || job.effectBarrier!==durable.effectBarrier
          || Date.parse(job.retainedUntil)!==durable.retainedUntil
          || job.cancelRequested!==(durable.cancelRequested===true)){
          throw new RemoteExecutionError('Final job receipt contradicts durable settlement; inspect the retained invocation','unknown',identity,502);
        }
      }
      if(s){
        const origins=jobReceipts.get(s)??new Map<string,Map<string,Job>>();
        const receipts=origins.get(base.origin)??new Map<string,Job>();
        const prior=receipts.get(job.jobId)
          ?? [...receipts.values()].find(receipt=>receipt.sessionId===job.sessionId
            && receipt.epoch===job.epoch && receipt.invocationId!==undefined && receipt.invocationId===job.invocationId);
        if(prior && prior.sessionId===job.sessionId && prior.epoch===job.epoch){
          const before=prior.jobState;const after=job.jobState;
          // JSON object field order is irrelevant to immutable wire evidence.
          const equal=(left:unknown,right:unknown):boolean=>{
            if(left===right)return true;
            if(!left || !right || typeof left!=='object' || typeof right!=='object')return false;
            const fields=Object.keys(left);
            return fields.length===Object.keys(right).length
              && fields.every(field=>Object.hasOwn(right,field) && equal(Reflect.get(left,field),Reflect.get(right,field)));
          };
          const stages=['accepted','running','process-exited','io-settled','unknown-outcome','sandbox-lost'];
          if(prior.jobId!==job.jobId || prior.invocationId!==job.invocationId || prior.buildDigest!==job.buildDigest
            || Date.parse(prior.retainedUntil)!==Date.parse(job.retainedUntil)
            // A live receipt can precede its journal write. Once delivered,
            // those observations remain evidence during reconnect as well.
            || BigInt(job.effectBarrier)<BigInt(prior.effectBarrier)
            || prior.outputComplete && job.effectBarrier!==prior.effectBarrier
            || prior.processOutcome && !equal(prior.processOutcome,job.processOutcome)
            || prior.cancelRequested && !job.cancelRequested
            || prior.outputComplete && !job.outputComplete
            || prior.cleanup==='complete' && job.cleanup!=='complete'
            || before && (!after || BigInt(after.sequence)<BigInt(before.sequence)
              || after.sequence===before.sequence && !equal(before,after)
              || stages.indexOf(after.stage)<stages.indexOf(before.stage)
              || BigInt(after.effectBarrier)<BigInt(before.effectBarrier)
              || before.outputComplete && before.cleanup==='complete' && after.effectBarrier!==before.effectBarrier
              || before.processOutcome && !equal(before.processOutcome,after.processOutcome)
              // Loss preserves earlier exit evidence but closes observation
              // authority. Credential renewal cannot invent a later native exit.
              || (before.stage==='unknown-outcome' || before.stage==='sandbox-lost')
                && (!before.processOutcome && after.processOutcome || !prior.processOutcome && job.processOutcome)
              // Exit and loss close cancellation action authority. A later
              // request remains observable, but cannot manufacture a signal
              // receipt after that durable boundary across reconnects.
              || !before.cancelActed && after.cancelActed
                && (before.processOutcome || before.stage==='unknown-outcome' || before.stage==='sandbox-lost')
              || before.cancelRequested && !after.cancelRequested || before.cancelActed && !after.cancelActed
              || before.outputComplete && !after.outputComplete
              || before.cleanup==='complete' && after.cleanup!=='complete')){
            throw new UnrecoverableTransportError({...identity,jobId:prior.jobId});
          }
        }
        receipts.set(job.jobId,structuredClone(job));origins.set(base.origin,receipts);jobReceipts.set(s,origins);
      }
    }
    return value;
    } finally {
      if(retirement)activeUploadRetirements--;
      else if(uploadControl)activeUploadControls--;
    }
  }
  const client = {
    capabilities(signal?:AbortSignal):Promise<Capabilities>{return control('capabilities','Capabilities','GET',undefined,undefined,undefined,signal);},
    openSession(input:SessionRequest,key:string,signal?:AbortSignal):Promise<Session>{validateWire('SessionRequest',input);return control('sessions','Session','POST',input,undefined,key,signal);},
    inspectSession(s:SessionIdentity,signal?:AbortSignal):Promise<Session>{return control(path(s),'Session','GET',undefined,s,undefined,signal);},
    renewSession(s:SessionIdentity,leaseMs:number,key:string,signal?:AbortSignal):Promise<Session>{return control(path(s,'lease'),'Session','POST',{leaseMs},s,key,signal);},
    closeSession(s:SessionIdentity,key:string,signal?:AbortSignal):Promise<Session>{return control(path(s),'Session','DELETE',undefined,s,key,signal);},
    inspectOperation(key:string,s?:SessionIdentity,signal?:AbortSignal):Promise<OperationLookup>{return control(s?path(s,'operations/'+encodeURIComponent(key)):'operations/'+encodeURIComponent(key),'OperationLookup','GET',undefined,s,undefined,signal,{operationKey:key});},
    async putDependencyManifest(s:SessionIdentity,input:DependencyManifest,key:string,signal?:AbortSignal):Promise<StoredManifest>{
      validateDependencyManifest(input,{maxEntries:max,maxPathBytes:max});if(input.sessionId!==s.sessionId||input.epoch!==s.epoch)throw new TypeError('Dependency manifest session mismatch');
      const revision=input.revision;const receipt=await control<StoredManifest>(path(s,'manifests'),'StoredManifest','POST',input,s,key,signal,{},'dependency-manifest-v1');
      if(receipt.revision!==revision)throw new RemoteExecutionError('Dependency manifest receipt mismatch','unknown',{...s,operationKey:key},502);return receipt;
    },
    async getDependencyManifest(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<DependencyManifest>{
      const manifest=await control<DependencyManifest>(path(s,'manifests/'+encodeURIComponent(id)),'DependencyManifest','GET',undefined,s,undefined,signal,{operationId:id},'dependency-manifest-v1');
      validateDependencyManifest(manifest,{maxEntries:max,maxPathBytes:max});if(manifest.sessionId!==s.sessionId||manifest.epoch!==s.epoch)throw new RemoteExecutionError('Dependency manifest authority mismatch','unknown',{...s,operationId:id},502);return manifest;
    },
    async prepareDependencies(s:SessionIdentity,input:DependencyMaterializeRequest,key:string,signal?:AbortSignal):Promise<DependencyMaterialization>{
      validateWire('DependencyMaterializeRequest',input);if(input.sessionId!==s.sessionId||input.epoch!==s.epoch||input.operationKey!==key)throw new TypeError('Dependency preparation session/key mismatch');
      const expected={manifestId:input.manifestId,manifestRevision:input.manifestRevision};const receipt=await control<DependencyMaterialization>(path(s,'materializations'),'DependencyMaterialization','POST',input,s,key,signal,{},'dependency-manifest-v1');
      if(receipt.manifestId!==expected.manifestId||receipt.manifestRevision!==expected.manifestRevision)throw new RemoteExecutionError('Dependency preparation receipt mismatch','unknown',{...s,operationKey:key},502);return receipt;
    },
    async inspectDependencies(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<DependencyMaterialization>{
      const receipt=await control<DependencyMaterialization>(path(s,'materializations/'+encodeURIComponent(id)),'DependencyMaterialization','GET',undefined,s,undefined,signal,{operationId:id},'dependency-manifest-v1');
      if(receipt.operationId!==id)throw new RemoteExecutionError('Dependency preparation identity mismatch','unknown',{...s,operationId:id},502);return receipt;
    },
    async submitDependencyJob(s:SessionIdentity,input:DependencyJobRequest,key:string,signal?:AbortSignal):Promise<Job>{
      validateWire('DependencyJobRequest',input);validateManifestInvocation(input.dependencyBinding.invocation,{maxArguments:input.limits.maxArgvBytes,maxArgvBytes:input.limits.maxArgvBytes,maxPathBytes:max});
      return control<Job>(path(s,'jobs'),'Job','POST',input,s,key,signal,{},'dependency-manifest-v1');
    },
    async beginUpload(s:SessionIdentity,input:UploadRequest,key:string,signal?:AbortSignal):Promise<Upload>{
      signal?.throwIfAborted();
      if(!input || typeof input!=='object' || Array.isArray(input))throw new TypeError('Invalid upload request');
      // Validate the owned declaration sent to the server, observing caller
      // getters once so admission cannot bind a different size or digest.
      const declaration={...input};validateWire('UploadRequest',declaration);const recovery={...s,operationKey:key};
      const receipt=await control<Upload>(path(s,'uploads'),'Upload','POST',declaration,s,key,signal,recovery);
      if(receipt.size!==declaration.size || receipt.digest!==declaration.digest)throw new RemoteExecutionError('Upload receipt declaration mismatch; inspect before retrying','unknown',recovery,502);
      return receipt;
    },
    async inspectUpload(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<Upload>{
      const recovery={...s,operationId:id};
      const receipt=await control<Upload>(path(s,'uploads/'+uploadRouteId(id)),'Upload','GET',undefined,s,undefined,signal,recovery);
      if(receipt.uploadId!==id)throw new RemoteExecutionError('Upload receipt identity mismatch','unknown',recovery,502);
      return receipt;
    },
    async uploadChunk(s:SessionIdentity,id:string,offset:bigint,bytes:Uint8Array,digestHeader:string,key:string,signal?:AbortSignal):Promise<Upload & {replayed:boolean}>{
      signal?.throwIfAborted();
      if(typeof offset!=='bigint')throw new TypeError('Upload chunk offset must be bigint');
      if(!(bytes instanceof Uint8Array))throw new TypeError('Binary upload chunk required');
      validateWire('Uint64',String(offset));if(uploadByteLength(bytes)>batch)throw new TypeError('Upload chunk exceeds SDK bound');
      if(!uploadByteLength(bytes))throw new TypeError('Empty chunk; commit zero-length uploads directly');
      const end=offset+BigInt(uploadByteLength(bytes));validateWire('Uint64',String(end));
      const recovery={...s,operationId:id,operationKey:key};
      if(activeUploads>=concurrency)throw new RemoteExecutionError('Upload client concurrency bound','notAccepted',recovery,429);
      activeUploads++;
      try {
        const result=await response(path(s,`uploads/${uploadRouteId(id)}/bytes`),'PUT',new Uint8Array(bytes),s,key,'application/octet-stream',signal,recovery,{'Upload-Offset':String(offset),'Content-Length':String(uploadByteLength(bytes)),'Content-Digest':digestHeader});
        const receipt=await document<Upload>(result,'Upload',recovery,signal);
        const replay=result.headers.get('Upload-Replayed');const acknowledged=BigInt(receipt.committedOffset);
        if(receipt.uploadId!==id || receipt.state!=='open' || acknowledged>BigInt(receipt.size)
          || (replay!=='true' && replay!=='false') || acknowledged<end || (replay==='false' && acknowledged!==end)) {
          throw new RemoteExecutionError('Upload chunk acknowledgement mismatch; inspect before retrying','unknown',recovery,502);
        }
        return {...receipt,replayed:replay==='true'};
      } finally { activeUploads--; }
    },
    commitUpload(s:SessionIdentity,id:string,key:string,signal?:AbortSignal):Promise<Blob>{return control(path(s,`uploads/${uploadRouteId(id)}/commit`),'Blob','POST',undefined,s,key,signal,{operationId:id});},
    async abortUpload(s:SessionIdentity,id:string,key:string,signal?:AbortSignal):Promise<Upload>{
      const recovery={...s,operationId:id,operationKey:key};
      const receipt=await control<Upload>(path(s,'uploads/'+uploadRouteId(id)),'Upload','DELETE',undefined,s,key,signal,recovery);
      if(receipt.uploadId!==id || receipt.state!=='aborted')throw new RemoteExecutionError('Upload abort acknowledgement mismatch; inspect before retrying','unknown',recovery,502);
      return receipt;
    },
    async inspectBlob(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<Blob>{
      const recovery={...s,operationId:id};
      const receipt=await control<Blob>(path(s,'blobs/'+uploadRouteId(id)),'Blob','GET',undefined,s,undefined,signal,recovery);
      if(receipt.blobId!==id)throw new RemoteExecutionError('Blob receipt identity mismatch','unknown',recovery,502);
      return receipt;
    },
    async readBlobRange(s:SessionIdentity,id:string,start:bigint,endInclusive?:bigint,signal?:AbortSignal):Promise<Response>{
      if(typeof start!=='bigint' || (endInclusive!==undefined && typeof endInclusive!=='bigint'))throw new TypeError('Blob range offsets must be bigint');
      validateWire('Uint64',String(start));if(endInclusive!==undefined){validateWire('Uint64',String(endInclusive));if(endInclusive<start)throw new TypeError('Invalid range');}return response(path(s,`blobs/${uploadRouteId(id)}/bytes`),'GET',undefined,s,undefined,undefined,signal,{...s,operationId:id},{Range:`bytes=${start}-${endInclusive??''}`});
    },
    async putManifest(s:SessionIdentity,exactJson:Uint8Array,key:string,signal?:AbortSignal):Promise<{manifestId:string;digest:string}>{
      if(exactJson.length>max)throw new TypeError('Manifest document exceeds bound');validateWire('Manifest',parseWireJson(new TextDecoder('utf-8',{fatal:true}).decode(exactJson)));
      const result=await response(path(s,'manifests'),'POST',new Uint8Array(exactJson),s,key,'application/json',signal,{...s,operationKey:key});return document(result,'ManifestReceipt',{...s,operationKey:key},signal);
    },
    getManifest(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<Manifest>{return control(path(s,'manifests/'+encodeURIComponent(id)),'Manifest','GET',undefined,s,undefined,signal);},
    openFile(s:SessionIdentity,input:FileOpenRequest,key:string,signal?:AbortSignal):Promise<FileHandle>{validateWire('FileOpenRequest',input);return control(path(s,'file-handles'),'FileHandle','POST',input,s,key,signal);},
    fileMetadata(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<FileMetadata>{return control(path(s,'file-handles/'+encodeURIComponent(id)),'FileMetadata','GET',undefined,s,undefined,signal);},
    closeFile(s:SessionIdentity,id:string,key:string,signal?:AbortSignal):Promise<{released:true}>{return control(path(s,'file-handles/'+encodeURIComponent(id)),'Released','DELETE',undefined,s,key,signal);},
    listFiles(s:SessionIdentity,input:FileListRequest,key:string,signal?:AbortSignal):Promise<FileListing>{validateWire('FileListRequest',input);return control(path(s,'file-listings'),'FileListing','POST',input,s,key,signal);},
    async readFileRange(s:SessionIdentity,id:string,start:bigint,endInclusive?:bigint,signal?:AbortSignal):Promise<Response>{validateWire('Uint64',String(start));if(endInclusive!==undefined){validateWire('Uint64',String(endInclusive));if(endInclusive<start)throw new TypeError('Invalid file range');}return response(path(s,`file-handles/${encodeURIComponent(id)}/bytes`),'GET',undefined,s,undefined,undefined,signal,{...s,operationId:id},{Range:`bytes=${start}-${endInclusive??''}`});},
    materialize(s:SessionIdentity,input:MaterializeRequest,key:string,signal?:AbortSignal):Promise<Materialization>{validateWire('MaterializeRequest',input);return control(path(s,'materializations'),'Materialization','POST',input,s,key,signal);},
    inspectMaterialization(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<Materialization>{return control(path(s,'materializations/'+encodeURIComponent(id)),'Materialization','GET',undefined,s,undefined,signal);},
    submitJob(s:SessionIdentity,input:JobRequest,key:string,signal?:AbortSignal):Promise<Job>{validateWire('JobRequest',input);return control(path(s,'jobs'),'Job','POST',input,s,key,signal);},
    async listJobs(s:SessionIdentity,signal?:AbortSignal):Promise<Job[]>{const result=await response(path(s,'jobs'),'GET',undefined,s,undefined,undefined,signal,s);return document(result,'JobList',s,signal);},
    inspectJob(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<Job>{return control(path(s,'jobs/'+encodeURIComponent(id)),'Job','GET',undefined,s,undefined,signal,{jobId:id});},
    inspectEffects(s: SessionIdentity, id: string, signal?: AbortSignal): Promise<EffectManifest> { return control(path(s, `jobs/${encodeURIComponent(id)}/effects`), 'EffectManifest', 'GET', undefined, s, undefined, signal, { jobId: id }); },
    outputMetadata(s: SessionIdentity, id: string, identityId: string, signal?: AbortSignal): Promise<FileMetadata> { return control(path(s, `jobs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(identityId)}`), 'FileMetadata', 'GET', undefined, s, undefined, signal, { jobId: id }); },
    async readOutputRange(s: SessionIdentity, id: string, identityId: string, start: bigint, endInclusive?: bigint, signal?: AbortSignal, version?: string): Promise<Response> {
      s = { ...s };
      validateWire('Uint64', String(start)); if (endInclusive !== undefined) { validateWire('Uint64', String(endInclusive)); if (endInclusive < start) throw new TypeError('Invalid output range'); }
      const result = await response(path(s, `jobs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(identityId)}/bytes`), 'GET', undefined, s, undefined, undefined, signal, { jobId: id }, { Range: `bytes=${start}-${endInclusive ?? ''}`, ...(version ? { 'If-Match': version } : {}) });
      let expectedBytes: bigint;
      try {
        const range = result.headers.get('Content-Range')?.split(' ');
        if (version && result.headers.get('ETag') !== version) throw new TypeError('Output source identity or version changed');
        const extent = range?.[1]?.split('/'); const bounds = extent?.[0]?.split('-');
        if (result.status !== 206 || result.headers.get('Content-Type') !== 'application/octet-stream' || range?.length !== 2 || range[0] !== 'bytes' || extent?.length !== 2 || bounds?.length !== 2) throw new TypeError('Invalid output range response');
        for (const value of [...bounds, extent[1]]) validateWire('Uint64', value);
        const first = BigInt(bounds[0]); const last = BigInt(bounds[1]); const size = BigInt(extent[1]);
        const expectedLast = endInclusive === undefined || endInclusive >= size ? size - 1n : endInclusive;
        if (first !== start || last < first || last >= size || last !== expectedLast) throw new TypeError('Invalid output range response');
        expectedBytes = last - first + 1n;
        const length = result.headers.get('Content-Length');
        if (length !== null) { validateWire('Uint64', length); if (BigInt(length) !== last - first + 1n) throw new TypeError('Invalid output range response'); }
      } catch (cause) {
        const error = new TypeError('Invalid output range response', { cause });
        try { await result.body?.cancel(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Output range response cleanup failed', { cause: error }); }
        throw error;
      }
      if (!result.body) throw new TypeError('Missing output range body');
      const recovery = {...s,jobId:id};
      const reader = result.body.getReader();
      const source = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const part = await reader.read();
            if (part.done) { reader.releaseLock(); controller.close(); }
            else controller.enqueue(part.value);
          } catch (cause) {
            reader.releaseLock();
            const status=cause instanceof Error?(cause as Error & {status?:number}).status:undefined;
            controller.error(signal?.aborted ? signal.reason : status===410 ? new UnrecoverableTransportError(recovery,{cause}) : new RemoteExecutionError('Output range delivery interrupted; inspect retained output before retrying','unknown',recovery,status===401||status===403?status:undefined,{cause}));
          }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
      }, {highWaterMark:0});
      let received = 0n;
      const body = source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(bytes, controller) {
          if (!(bytes instanceof Uint8Array)) throw new TypeError('Output range contains invalid bytes');
          received += BigInt(uploadByteLength(bytes));
          if (received > expectedBytes) throw new TypeError('Output range exceeds its receipt');
          controller.enqueue(bytes);
        },
        flush() { if (received !== expectedBytes) throw new RemoteExecutionError('Output range interrupted; inspect retained output before retrying','unknown',recovery); },
      }), { signal });
      return new Response(body, { status: result.status, statusText: result.statusText, headers: result.headers });
    },
    async retrieveJobOutputs(s: SessionIdentity, id: string, logicalRoot: string, destination: OutputDestination, cursor?: OutputTransferCursor, signal?: AbortSignal) {
      s = { ...s };
      const manifest = await client.inspectEffects(s, id, signal);
      const bindings = new Map<string, OutputFreshness>();
      const identities = new Map([...cursor?.sources?.values() ?? []].map(value => [value.identityId, value.identity]));
      async function metadata(identity: string, signal?: AbortSignal, version?: string) {
        const result = await response(path(s, `jobs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(identity)}`), 'GET', undefined, s, undefined, undefined, signal, { jobId: id }, version ? { 'If-Match': version } : undefined);
        const etag = result.headers.get('ETag');
        const value = await document<FileMetadata>(result, 'FileMetadata', { ...s, jobId: id }, signal);
        if (version && etag !== version) throw new Error('Output source identity or version changed');
        return { value, etag };
      }
      return retrieveOutputs(manifest, logicalRoot, {
        scope: JSON.stringify([base.href, s.sessionId, s.epoch, id]),
        async freshness(identity, signal) {
          const { etag } = await metadata(identity, signal);
          // Only strong, server-qualified representation validators authorize
          // preservation of an acknowledged prefix across requests.
          if (!etag || !etag.startsWith('"') || !etag.endsWith('"') || etag.length < 3 || etag.length > 256) return undefined;
          const guard: OutputFreshness = { identity: identities.get(identity) ?? {}, version: etag, async assertCurrent(signal) { await metadata(identity, signal, etag); } };
          bindings.set(identity, guard); return guard;
        },
        async metadata(identity, signal) { return (await metadata(identity, signal, bindings.get(identity)?.version)).value; },
        async range(identity, start, signal) { const result = await client.readOutputRange(s, id, identity, start, undefined, signal, bindings.get(identity)?.version); if (!result.body) throw new Error('Missing output body'); return result.body; },
      }, destination, cursor, signal);
    },
    waitJob(s:SessionIdentity,id:string,signal?:AbortSignal):Promise<Job>{return control(path(s,`jobs/${encodeURIComponent(id)}/wait`),'Job','GET',undefined,s,undefined,signal,{jobId:id});},
    cancelJob(s:SessionIdentity,id:string,input:{reason:string},key:string,signal?:AbortSignal):Promise<Job>{return control(path(s,`jobs/${encodeURIComponent(id)}/cancel`),'Job','POST',input,s,key,signal,{jobId:id});},
    signalJob(s:SessionIdentity,id:string,nativeSignal:string,key:string,signal?:AbortSignal):Promise<Job>{return control(path(s,`jobs/${encodeURIComponent(id)}/signal`),'Job','POST',{signal:nativeSignal},s,key,signal,{jobId:id});},
    attach(s:SessionIdentity,id:string,input:LaneRequest,key:string,signal?:AbortSignal,owner:'jobs'|'materializations'='jobs'):Promise<Lane>{return control(ownerPath(s,id,owner)+'/lanes','Lane','POST',input,s,key,signal,{jobId:id});},
    async *readFrames(s:SessionIdentity,id:string,laneId:string,sequence:bigint,limits:BinaryOptions,signal?:AbortSignal,owner:'jobs'|'materializations'='jobs'):AsyncGenerator<BinaryFrame>{
      // Credential acquisition and delivery can yield while the caller reuses
      // its session carrier. Recovery must still identify the admitted stream.
      s={...s};
      validateWire('Uint64',String(sequence));const result=await response(ownerPath(s,id,owner)+`/lanes/${encodeURIComponent(laneId)}/frames`,'GET',undefined,s,undefined,undefined,signal,{...s,jobId:id,laneId,sequence:String(sequence)},{'Execution-Cursor':String(sequence)});
      if(result.headers.get('Content-Type')!==binaryContentType||!result.body){
        let disposal:ErrorOptions|undefined;
        try{await result.body?.cancel();}catch(cause){disposal={cause};}
        if(signal?.aborted)throw signal.reason;
        throw new RemoteExecutionError('Invalid binary lane receipt; inspect retained cursors before retrying','unknown',{...s,jobId:id,laneId,sequence:String(sequence)},502,disposal);
      }
      try{for await(const frame of decodeFrames(result.body,{...limits,firstSequence:sequence,channelOpenDirection:'write',requireEnd:limits.requireEnd??true,validateControl:v=>validateWire('Control',v)},signal)){sequence=frame.sequence+1n;yield frame;}}catch(cause){
        if(signal?.aborted)throw signal.reason;
        const recovery={...s,jobId:id,laneId,sequence:String(sequence)};
        // In-process/provider transports can retain a classified failure after
        // headers were delivered. Ordinary network disconnects remain unknown;
        // do not infer expiry or authorization failure from their message.
        const status=cause instanceof Error?(cause as Error & {status?:number}).status:undefined;
        if(status===410)throw new UnrecoverableTransportError(recovery,{cause});
        throw new RemoteExecutionError('Binary delivery interrupted; inspect retained cursors before retrying','unknown',recovery,status===401||status===403?status:undefined,{cause});
      }
    },
    async sendFrames(s:SessionIdentity,id:string,laneId:string,frames:readonly BinaryFrame[],limits:BinaryOptions,key:string,signal?:AbortSignal,owner:'jobs'|'materializations'='jobs'):Promise<Ack>{
      s={...s};
      let size=0;for(const frame of frames){size+=40+frame.payload.length;if(size>batch)throw new TypeError('Input batch exceeds SDK bound');}
      const body=new Uint8Array(size);let offset=0;for(const frame of frames){const bytes=encodeFrame(frame,{...limits,validateControl:v=>validateWire('Control',v)});body.set(bytes,offset);offset+=bytes.length;}
      // Pin delivery boundaries before credential acquisition yields. Replays
      // may return a later accepted boundary, but never a contradictory receipt
      // for the submitted boundary or an offset behind its completed writes.
      const lastSequence=frames.at(-1)?.sequence;
      const submittedOffsets=new Map(frames.filter(frame=>frame.kind!=='control').map(frame=>[frame.channelId,frame.offset+BigInt(frame.payload.length)]));
      const endedChannels=new Set(frames.filter(frame=>frame.kind==='end').map(frame=>frame.channelId));
      const recovery={...s,jobId:id,laneId,operationKey:key};
      const receipt=await document<Ack>(await response(ownerPath(s,id,owner)+`/lanes/${encodeURIComponent(laneId)}/frames`,'POST',body,s,key,binaryContentType,signal,recovery,{'Execution-Cursor':String(frames[0]?.sequence??1n)}),'Ack',recovery,signal);
      const sequence=BigInt(receipt.sequence);
      const offsets=new Map(receipt.offsets.map(value=>[value.channelId,BigInt(value.offset)]));
      if(receipt.laneId!==laneId || offsets.size!==receipt.offsets.length
        || lastSequence!==undefined && (sequence<lastSequence || [...submittedOffsets].some(([channelId,end])=>{
          const delivered=offsets.get(channelId);
          return delivered===undefined || delivered<end || (sequence===lastSequence || endedChannels.has(channelId)) && delivered!==end;
        })))throw new RemoteExecutionError('Input acknowledgement mismatch; inspect retained input before retrying','unknown',recovery,502);
      return receipt;
    },
    ackFrames(s:SessionIdentity,id:string,laneId:string,ack:Ack,key:string,signal?:AbortSignal,owner:'jobs'|'materializations'='jobs'):Promise<Ack>{return control(ownerPath(s,id,owner)+`/lanes/${encodeURIComponent(laneId)}/ack`,'Ack','POST',ack,s,key,signal,{jobId:id,laneId});},
    answerCallback(s:SessionIdentity,id:string,result:CallbackResult,key:string,signal?:AbortSignal,owner:'jobs'|'materializations'='jobs'):Promise<CallbackResult>{return control(ownerPath(s,id,owner)+`/callbacks/${encodeURIComponent(result.callbackId)}/result`,'CallbackResult','POST',result,s,key,signal,{jobId:id,operationId:result.operationId});},
    releaseResources(s:SessionIdentity,id:string,input:ReleaseRequest,key:string,signal?:AbortSignal):Promise<Job>{return control(path(s,`jobs/${encodeURIComponent(id)}/resources/release`),'Job','POST',input,s,key,signal,{jobId:id});},
    /** Cursor belongs to the same canonical sinks and host bindings across reconnects.
     * Completed writes advance before HTTP acknowledgment. A rejected sink may
     * have partially written: require explicit recovery rather than replay it. */
    async resumeStream(cursor:StreamCursor,limits:BinaryOptions,consume:(frame:BinaryFrame)=>Promise<void>,signal?:AbortSignal):Promise<void> {
      if(cursor.busy || streamDeliveries.get(cursor)?.busy)throw new TypeError('Stream cursor already has a consumer');
      const submitted={sessionId:cursor.sessionId,epoch:cursor.epoch,jobId:cursor.jobId,laneId:cursor.laneId};
      const retained=streamDeliveries.get(cursor);
      const identity=retained?.identity??submitted;
      const recovery={...identity,sequence:String(retained?.nextSequence??cursor.nextSequence)};
      // Opaque invocation and lane IDs only identify resources at their issuing
      // service. Delivery credit must never be transferred to another origin.
      if(retained && retained.origin!==base.origin)throw new UnrecoverableTransportError(recovery);
      if(identity.sessionId!==submitted.sessionId || identity.epoch!==submitted.epoch || identity.jobId!==submitted.jobId || identity.laneId!==submitted.laneId)throw new UnrecoverableTransportError(recovery);
      if(retained?.deliveryUnknown)throw new UnrecoverableTransportError(recovery,{cause:retained.deliveryCause});
      // Delivery belongs to the sink that accepted the prefix, including END.
      // A new sink cannot recover that prefix from acknowledged transport bytes.
      if(retained?.consumer && retained.consumer!==consume)throw new UnrecoverableTransportError(recovery);
      if(retained && (cursor.nextSequence!==retained.nextSequence
        || cursor.offsets.size!==retained.offsets.size || [...retained.offsets].some(([channel,offset])=>cursor.offsets.get(channel)!==offset)
        || cursor.endedChannels.size!==retained.endedChannels.size || [...retained.endedChannels].some(channel=>!cursor.endedChannels.has(channel))))throw new UnrecoverableTransportError(recovery);
      const delivery=retained??{origin:base.origin,identity,nextSequence:cursor.nextSequence,offsets:new Map(cursor.offsets),endedChannels:new Set(cursor.endedChannels)};
      streamDeliveries.set(cursor,delivery);
      if(cursor.deliveryUnknown)throw new UnrecoverableTransportError(recovery,{cause:cursor.deliveryCause});
      cursor.busy=true;
      delivery.busy=true;
      async function acknowledge(ackSignal:AbortSignal|undefined){
        if(delivery.nextSequence===1n)return;
        const ack:Ack={type:'Ack',laneId:identity.laneId,sequence:String(delivery.nextSequence-1n),offsets:[...delivery.offsets].map(([channelId,offset])=>({channelId,offset:String(offset)}))};
        const receipt=await client.ackFrames(identity,identity.jobId,identity.laneId,ack,'stream-ack:'+identity.laneId+':'+ack.sequence,ackSignal);
        const offsets=new Map(receipt.offsets.map(value=>[value.channelId,value.offset]));
        if(receipt.laneId!==ack.laneId || receipt.sequence!==ack.sequence || offsets.size!==receipt.offsets.length
          || offsets.size!==ack.offsets.length || ack.offsets.some(value=>offsets.get(value.channelId)!==value.offset)) {
          throw new RemoteExecutionError('Stream acknowledgement mismatch; inspect retained delivery before retrying','unknown',{
            ...recovery,sequence:String(delivery.nextSequence),
          },502);
        }
      }
      try{
        await acknowledge(signal);
        for await(const frame of client.readFrames(identity,identity.jobId,identity.laneId,delivery.nextSequence,{...limits,channels:[...delivery.offsets.keys()],offsets:new Map(delivery.offsets),endedChannels:[...delivery.endedChannels]},signal)){
          // Consumers own the delivered frame and may reuse or replace its bytes.
          // Retain validated transport identity before any canonical write runs.
          const {kind,channelId,sequence,offset}=frame;
          const endOffset=offset+BigInt(frame.payload.length);
          const control=kind==='control'?parseWireJson(new TextDecoder('utf-8',{fatal:true}).decode(frame.payload)) as {type:string;direction?:string;channelId?:number}:undefined;
          delivery.consumer=consume;
          try{await consume(frame);}catch(cause){
            cursor.deliveryUnknown=true;cursor.deliveryCause=cause;
            delivery.deliveryUnknown=true;delivery.deliveryCause=cause;
            // A destination can fail after applying a prefix. The first failure
            // needs the same explicit recovery result as a subsequent reconnect;
            // neither the retained frame nor its write may be replayed blindly.
            throw new UnrecoverableTransportError({...recovery,sequence:String(sequence)},{cause});
          }
          if(kind==='control'){
            if(control?.type==='ChannelOpen'&&control.direction==='write')delivery.offsets.set(control.channelId!,0n);
          }else delivery.offsets.set(channelId,endOffset);
          if(kind==='end')delivery.endedChannels.add(channelId);
          delivery.nextSequence=sequence+1n;
          // Retain completed delivery independently of caller-owned fields. A
          // reused cursor cannot retract a sink write or clear its uncertainty
          // when a replacement client retries a lost acknowledgment.
          cursor.nextSequence=delivery.nextSequence;
          cursor.offsets=new Map(delivery.offsets);
          cursor.endedChannels=new Set(delivery.endedChannels);
          // The destination has accepted this effect. Returning its credit is
          // owned settlement, even when invocation cancellation raced the write.
          // Admission of the next frame still uses the caller's signal.
          await acknowledge(undefined);
        }
      }finally{cursor.busy=false;delivery.busy=false;}
    },
  };
  return client;
}
