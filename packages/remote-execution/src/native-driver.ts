import {createNativeLauncher,maxNativeStreamChannels,nativeArgumentOctets,nativeArgumentText,nativeEnvironment,type NativeLauncher,type NativeProcessSpec,type NativeProcess}from'./native-process.js';
import type{MediaIsolationDriver,SessionAuthority,PreparedInvocation}from'./media-server.js';
export interface NativeIsolationBackend extends Omit<MediaIsolationDriver,'admitSession'> {
 admitSession(input:Parameters<MediaIsolationDriver['admitSession']>[0]):Promise<Omit<SessionAuthority,'prepare'> & {
   /** Install logical cwd/assets, authenticate handles/env, enforce CPU/memory/
    * process limits, and mediate every native/delegate file/socket operation.
    * Native descriptors below are trusted leases, never wire handle integers. */
   prepare(input:Parameters<SessionAuthority['prepare']>[0]):Promise<{cwd:string;env:Record<string,string>;stdio?:NativeProcessSpec['stdio'];close():Promise<void>}>;
 }>;
}
/** Wires a qualified namespace backend to the real Node process API. It supplies
 * executable and literal argv from declarative tool/request data; a backend cannot
 * replace them with an arbitrary shell string or silently relaunch a native job. */
export function createNativeDriver(config:{backend:NativeIsolationBackend;launcher?:NativeLauncher}):MediaIsolationDriver {
 const launcher=config.launcher??createNativeLauncher();
 const suppliedProfile=launcher.argvProfile;
 const profile=suppliedProfile?structuredClone(suppliedProfile):undefined;
 if(profile && (profile.kind!=='bytes'||typeof profile.revision!=='string'||!profile.revision||!Array.isArray(profile.evidence)||!profile.evidence.length||profile.evidence.some(value=>typeof value!=='string'||!value)))throw new TypeError('Invalid native byte launcher qualification');
 if(profile?.maxArgvBytes!==undefined&&(!Number.isSafeInteger(profile.maxArgvBytes)||profile.maxArgvBytes<1)||profile?.maxDescriptors!==undefined&&(!Number.isSafeInteger(profile.maxDescriptors)||profile.maxDescriptors<4||profile.maxDescriptors>1024))throw new TypeError('Invalid native byte launcher bound');
 const launch=launcher.launch.bind(launcher);
 const backend=config.backend;
 const limits={...backend.limits};
 if(limits.maxArgvBytes!==undefined&&(!Number.isSafeInteger(limits.maxArgvBytes)||limits.maxArgvBytes<1))throw new TypeError('Invalid native argv bound');
 if(limits.maxFrameBytes!==undefined&&(!Number.isSafeInteger(limits.maxFrameBytes)||limits.maxFrameBytes<1||limits.maxFrameBytes>1048576))throw new TypeError('Invalid native frame bound');
 if(limits.maxHandles!==undefined&&(!Number.isSafeInteger(limits.maxHandles)||limits.maxHandles<1))throw new TypeError('Native descriptor bound');
 if(profile?.maxArgvBytes!==undefined)limits.maxArgvBytes=Math.min(limits.maxArgvBytes??profile.maxArgvBytes,profile.maxArgvBytes);
 const nativeHandleLimit=(profile?.maxDescriptors??1024)-3;
 limits.maxHandles=Math.min(limits.maxHandles??nativeHandleLimit,nativeHandleLimit);
 const admitSession=backend.admitSession.bind(backend);
 const inspectBuild=backend.inspectBuild.bind(backend);
 return {limits:{...limits},features:[...structuredClone(backend.features).filter(f=>f.name!=='byte-argv'&&f.name!=='utf8-argv'),profile?{name:'byte-argv',evidence:profile.evidence}:{name:'utf8-argv',evidence:['nativeArgumentText: fatal UTF-8 decoding with BOM preservation; Node spawn shell:false']}],async inspectBuild(digest){
   const build=await inspectBuild(digest);
   if(profile && build.launcherRevision!==profile.revision)throw new TypeError('Native build does not match the byte argv launcher');
   return build;
 },
  async admitSession(input){
   const namespace=await admitSession(input);
   // Acquisition owns retirement before any backend authority getters run.
   // Keep the original receiver and method even if preparation replaces them.
   const closeNamespace=namespace.close.bind(namespace);
   try {
   const prepareNamespace=namespace.prepare.bind(namespace);
   const pending=new Set<Promise<PreparedInvocation>>();
   const active=new Set<PreparedInvocation>();
   const retirementFailures:unknown[]=[];let sessionClosing:Promise<void>|undefined;
   return {grants:namespace.grants,files:namespace.files,dependencies:namespace.dependencies,
    close(){
     sessionClosing??=(async()=>{
      await Promise.allSettled([...pending]);
      const invocations=await Promise.allSettled([...active].map(invocation=>Promise.resolve().then(()=>invocation.close())));
      const results=await Promise.allSettled([Promise.resolve().then(()=>closeNamespace())]);
      const failures=[...retirementFailures,...[...invocations,...results].filter((r):r is PromiseRejectedResult=>r.status==='rejected').map(r=>r.reason)];
      if(failures.length)throw new AggregateError(failures,'Native session retirement failed');
     })();void sessionClosing.catch(()=>{});return sessionClosing;
    },materialize:namespace.materialize?.bind(namespace),release:namespace.release?.bind(namespace),prepare(invocation){
    if(sessionClosing)throw new TypeError('Native session is retiring');
    const work=(async():Promise<PreparedInvocation>=>{
    invocation.signal.throwIfAborted();
    // Qualified transport ceilings apply before namespace installation, not
    // only when the process API later acquires its pipes.
    const maxFrameBytes=invocation.request.limits.maxFrameBytes;
    if((maxFrameBytes!==undefined||limits.maxFrameBytes!==undefined)&&(!Number.isSafeInteger(maxFrameBytes)||maxFrameBytes<1||maxFrameBytes>Math.min(limits.maxFrameBytes??1048576,1048576)))throw new TypeError('Invalid native frame bound');
    // Bound argv before cloning the request or installing native resources.
    const requestedArgvBytes=invocation.request.limits.maxArgvBytes??1048576;
    if(!Number.isSafeInteger(requestedArgvBytes)||requestedArgvBytes<1)throw new TypeError('Invalid native argv bound');
    const args=nativeArgumentOctets(invocation.request.args,limits.maxArgvBytes===undefined?requestedArgvBytes:Math.min(requestedArgvBytes,limits.maxArgvBytes));
    if(profile){
      if(invocation.build.launcherRevision!==profile.revision)throw new TypeError('Native build does not match the byte argv launcher');
    }else nativeArgumentText(args,invocation.request.limits.maxArgvBytes);
    const env=nativeEnvironment(invocation.request.env??{});
    // The driver is also a public server boundary. Do not rely on HTTP callers
    // to admit descriptor capacity before cloning or acquiring native leases.
    const requestedHandles=invocation.request.limits.maxHandles??nativeHandleLimit;
    if(!Number.isSafeInteger(requestedHandles)||requestedHandles<1)throw new TypeError('Native descriptor bound');
    const handleBudget=Math.min(requestedHandles,limits.maxHandles!);
    const suppliedDescriptors=invocation.request.descriptors??[];
    if(!Array.isArray(suppliedDescriptors)||suppliedDescriptors.length>handleBudget)throw new TypeError('Native descriptor count bound');
    const descriptorFds=new Set<number>();
    const admittedDescriptors=Array.from({length:suppliedDescriptors.length},(_,index)=>{
      if(!Object.hasOwn(suppliedDescriptors,index))throw new TypeError('Native descriptor slots required');
      const descriptor={...suppliedDescriptors[index]};
      if(!Number.isSafeInteger(descriptor.fd)||descriptor.fd<3||descriptor.fd>handleBudget+2||descriptorFds.has(descriptor.fd))throw new TypeError('Native descriptor mapping bound');
      // Rights are an allocation and authority boundary, not an arbitrary
      // includes-capable carrier. Read bounded own slots before cloning the
      // invocation or acquiring namespace resources.
      const rights=descriptor.rights;
      if(!Array.isArray(rights)||rights.length>4)throw new TypeError('Invalid native descriptor rights');
      descriptor.rights=Array.from({length:rights.length},(_,index)=>{
        if(!Object.hasOwn(rights,index))throw new TypeError('Invalid native descriptor rights');
        const right=rights[index];
        if(!['read','write','seek','stat'].includes(right))throw new TypeError('Invalid native descriptor rights');
        return right;
      });
      if(new Set(descriptor.rights).size!==descriptor.rights.length)throw new TypeError('Invalid native descriptor rights');
      if(descriptor.seekable && !descriptor.rights.includes('seek'))throw new TypeError('Native descriptor seek authority');
      descriptorFds.add(descriptor.fd);
      return descriptor;
    });
    // Retain admitted values before yielding. Namespace preparation receives its
    // own copy so installing assets cannot rewrite the eventual native command.
    invocation={...invocation,tool:structuredClone(invocation.tool),build:structuredClone(invocation.build),request:structuredClone({...invocation.request,args,env,descriptors:admittedDescriptors,limits:{...invocation.request.limits,maxFrameBytes}})};
    nativeEnvironment(invocation.build.runtimeEnvironment);
    // An injected raw process API is admitted only under its exact build-bound
    // launcher revision. Backend feature declarations cannot widen Node argv.
    if((invocation.tool.requiresFrontendContract || invocation.request.frontendContract!==undefined) && (!invocation.build.grammarRevision || !invocation.build.sourceRevision || invocation.request.frontendContract?.grammarRevision!==invocation.build.grammarRevision || invocation.request.frontendContract?.sourceRevision!==invocation.build.sourceRevision))throw new TypeError('Native build does not match the media frontend contract');
    if(Object.entries(invocation.build.runtimeEnvironment).some(([key,value])=>!Object.hasOwn(invocation.request.env,key)||invocation.request.env[key]!==value))throw new TypeError('Native runtime environment conflict');
    if(maxFrameBytes===undefined)throw new TypeError('Invalid native frame bound');
    const prepared=await prepareNamespace({...invocation,tool:structuredClone(invocation.tool),build:structuredClone(invocation.build),request:structuredClone(invocation.request)});
    const closePrepared=prepared.close.bind(prepared);
    // Acquisition transfers ownership before any installed-profile inspection.
    // Every failure from here must retire the lease, including throwing getters.
    try {
    if(invocation.signal.aborted||sessionClosing){
      invocation.signal.throwIfAborted();throw new TypeError('Native session is retiring');
    }
    // Capture the installed process profile once. Backend-owned mutable objects
    // must not change checked environment or native leases between prepare/start.
    const installedStdio=prepared.stdio;
    if(installedStdio!==undefined&&(!Array.isArray(installedStdio)||installedStdio.length<3||installedStdio.length>(profile?.maxDescriptors??1024))){
      throw new TypeError('Invalid installed native descriptors');
    }
    const installed={cwd:prepared.cwd,env:{...prepared.env},stdio:installedStdio?Array.from({length:installedStdio.length},(_,index)=>{
      if(!Object.hasOwn(installedStdio,index))throw new TypeError('Invalid installed native descriptors');
      return installedStdio[index];
    }):undefined};
    if(typeof installed.cwd!=='string'||!installed.cwd.startsWith('/')||installed.cwd.includes('\0')||new TextDecoder('utf-8',{ignoreBOM:true}).decode(new TextEncoder().encode(installed.cwd))!==installed.cwd)throw new TypeError('Invalid installed native cwd');
    if(installed.stdio?.some(fd=>fd!=='pipe'&&fd!=='ignore'&&(!Number.isInteger(fd)||typeof fd!=='number'||fd<0||fd>2147483647)))throw new TypeError('Invalid installed native descriptors');
    if (Object.entries(installed.env).some(([key,value])=>!Object.hasOwn(invocation.build.runtimeEnvironment,key)||invocation.build.runtimeEnvironment[key]!==value) || Object.entries(invocation.build.runtimeEnvironment).some(([key,value])=>installed.env[key]!==value || Object.hasOwn(invocation.request.env??{},key)&&invocation.request.env[key]!==value)) {
      throw new TypeError('Native runtime environment mismatch');
    }
    let process:NativeProcess|undefined;let started=false;let closing:Promise<void>|undefined;
    const descriptors=invocation.request.descriptors;
    // The backend installs leases but cannot enlarge the job's descriptor
    // authority. Holes may be ignored; every inherited lease or pipe beyond
    // standard I/O must belong to an explicitly admitted job descriptor.
    const admittedFds=new Set(descriptors.map(descriptor=>descriptor.fd));
    if(installed.stdio?.some((slot,fd)=>fd>=3&&slot!=='ignore'&&!admittedFds.has(fd)))throw new TypeError('Unadmitted installed native descriptor');
    const descriptions=new Map<string,typeof descriptors>();
    for(const descriptor of descriptors){const members=descriptions.get(descriptor.openDescriptionId)??[];members.push(descriptor);descriptions.set(descriptor.openDescriptionId,members);}
    if([...descriptions.values()].some(members=>members.length>1&&members.some(d=>typeof installed.stdio?.[d.fd]!=='number')))throw new TypeError('Duplicate native descriptors require an installed shared open description');
    const inputChannels=[...(invocation.request.stdin.kind==='stream'?[1]:[]),...descriptors.filter(d=>d.rights.includes('read')&&!d.seekable&&typeof installed.stdio?.[d.fd]!=='number').map(d=>d.fd+1)];
    const outputChannels=[2,3,...descriptors.filter(d=>d.rights.includes('write')&&!d.seekable&&typeof installed.stdio?.[d.fd]!=='number').map(d=>d.fd+1)];
    if(installed.stdio && [...inputChannels,...outputChannels].some(channel=>installed.stdio![channel-1]!=='pipe'))throw new TypeError('An admitted channel must map to an installed native pipe');
    // Only the installed namespace determines which handles consume pipes.
    // Admit its complete directional counts before transferring the lease or
    // starting a process; inherited native leases retain their separate ceiling.
    if(inputChannels.length>maxNativeStreamChannels||outputChannels.length>maxNativeStreamChannels)throw new TypeError('Native stream capacity exceeded');
    if(invocation.request.stdin.kind!=='stream'&&typeof installed.stdio?.[0]!=='number'||descriptors.some(d=>d.seekable&&typeof installed.stdio?.[d.fd]!=='number'))throw new TypeError('Seekable native handles were not installed');
    if(installed.stdio?.some((slot,fd)=>slot==='pipe'&&!inputChannels.includes(fd+1)&&!outputChannels.includes(fd+1)))throw new TypeError('An installed native pipe must have an admitted channel owner');
    const owned:PreparedInvocation={start(streams){if(started||closing||sessionClosing)throw new TypeError('Invocation already started or closed');invocation.signal.throwIfAborted();started=true;
      process=launch({executable:invocation.tool.executable,args:invocation.request.args,cwd:installed.cwd,env:{...invocation.request.env},inputChannels,outputChannels,stdio:installed.stdio,maxFrameBytes:invocation.request.limits.maxFrameBytes,maxArgvBytes:invocation.request.limits.maxArgvBytes},streams);return process;},
      close(){closing??=(async()=>{
        const results:PromiseSettledResult<unknown>[]=await Promise.allSettled(process?[
          ...inputChannels.map(async channel=>process!.closeInput?.(channel)),
          ...outputChannels.map(async channel=>process!.closeOutput?.(channel)),
          Promise.resolve().then(async()=>{
            if(process!.terminateGroup){await process!.terminateGroup();return;}
            // A failed spawn acquired no group. Every other outcome, including
            // an exited leader, requires retirement evidence for descendants.
            if((await process!.exit).kind!=='spawnError')throw Object.assign(new Error('Process-group termination could not be confirmed'),{category:'transport',code:'termination-unconfirmed'});
          }),process.exit,process.settled,
        ]:[]);
        const cleanup=await Promise.allSettled([Promise.resolve().then(()=>closePrepared())]);
        const failures=[...results,...cleanup].filter((result):result is PromiseRejectedResult=>result.status==='rejected');
        if(failures.length===1)throw failures[0]!.reason;
        if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Native invocation retirement failed');
        active.delete(owned);
      })();void closing.catch(()=>{});return closing;}};
    active.add(owned);return owned;
    } catch(failure) {
      try { await closePrepared(); }
      catch(retirement) {
        retirementFailures.push(retirement);
        if(!invocation.signal.aborted)throw new AggregateError([failure,retirement],'Native acquisition and retirement failed');
      }
      throw failure;
    }
   })();pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
   }};
   } catch(failure) {
    try { await closeNamespace(); }
    catch(retirement) { throw new AggregateError([failure,retirement],'Native session acquisition and retirement failed'); }
    throw failure;
   }
  },
 };
}
