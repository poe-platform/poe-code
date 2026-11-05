import { instantiateCore, callbackModule, posix, fsOperationError } from "#wasm-platform";
const encoder = new TextEncoder();
const overlayReceipt = Symbol("overlay observation");
const FS_ERROR_BRAND = Symbol.for("@poe-code/safe-fs.FsError");
function fsErr(code, msg) { const e = new Error(msg); e.code = code; e[FS_ERROR_BRAND] = true; return e; }
function readOperationError(text) {
  const codeEnd = text.indexOf(":"), opEnd = text.indexOf(":", codeEnd + 1), detailEnd = text.indexOf(":", opEnd + 1);
  const op = text.slice(codeEnd + 1, opEnd);
  return fsOperationError(text, op || undefined, op === "resolve" ? undefined : text.slice(detailEnd + 1), undefined, text.slice(opEnd + 1, detailEnd) || undefined);
}
const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

function createWasmInstance() {
  const collators = new Map();
  let zoneName, zoneFormatter;
  let instance;
  const loaded = instantiateCore({
    safe_bash: {
      wall_clock_ms: () => Date.now(),
      timezone_fields(ptr, len, seconds, offsetPtr, labelPtr, capacity) {
        const memory = instance.exports.memory.buffer;
        const name = decoder.decode(new Uint8Array(memory, ptr >>> 0, len >>> 0));
        try {
          if (zoneName !== name) {
            zoneFormatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
              timeZone: name, year: "numeric", month: "2-digit", day: "2-digit", era: "short",
              hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
            });
            zoneName = name;
          }
          const fields = Object.fromEntries(zoneFormatter.formatToParts(seconds * 1000).map(p => [p.type,p.value]));
          const wall = new Date(0);
          wall.setUTCFullYear(fields.era === "BC" ? 1 - Number(fields.year) : Number(fields.year), Number(fields.month)-1, Number(fields.day));
          wall.setUTCHours(Number(fields.hour),Number(fields.minute),Number(fields.second),0);
          const label = encoder.encode(fields.timeZoneName);
          if (label.length > capacity || !Number.isFinite(wall.getTime())) return -1;
          new DataView(memory).setInt32(offsetPtr >>> 0,wall.getTime()/1000-seconds,true);
          new Uint8Array(memory,labelPtr >>> 0,label.length).set(label);
          return label.length;
        } catch (e) {
          if (e instanceof RangeError) return -1;
          throw e;
        }
      },
      collator_open(ptr, len, lowerFirst) {
        const tag = decoder.decode(new Uint8Array(instance.exports.memory.buffer, ptr >>> 0, len >>> 0));
        try {
          if (!Intl.Collator.supportedLocalesOf([tag]).length) return 0;
          let id = collators.size + 1;
          while (collators.has(id)) id++;
          collators.set(id, new Intl.Collator(tag, lowerFirst ? { caseFirst: "lower" } : undefined));
          return id;
        } catch (error) {
          if (error instanceof RangeError) return 0;
          throw error;
        }
      },
      collator_compare(id, a, alen, b, blen) {
        const memory = instance.exports.memory.buffer;
        return Math.sign(collators.get(id).compare(
          decoder.decode(new Uint8Array(memory, a >>> 0, alen >>> 0)),
          decoder.decode(new Uint8Array(memory, b >>> 0, blen >>> 0)),
        ));
      },
      collator_close(id) { collators.delete(id); },
      fill_random_bytes(ptr, len) {
        try {
          const bytes = new Uint8Array(len >>> 0);
          globalThis.crypto.getRandomValues(bytes);
          new Uint8Array(instance.exports.memory.buffer, ptr >>> 0, bytes.length).set(bytes);
          return 0;
        } catch {
          return -1;
        }
      },
    },
  });
  if (loaded instanceof Promise) return loaded.then(value => instance = value);
  return instance = loaded;
}

export class ShellLimitError extends Error {
  constructor(limit) {
    super(`Shell limit exceeded: ${limit}`);
    this.name = "ShellLimitError";
    this.limit = limit;
  }
}

// JSPI preserves the Wasm VM stack. Rust also keeps addressable locals in
// linear memory. Save that range while awaiting input so another shell can run.
const streamHosts = new WeakMap();
function suspendingCallback(read, resume) {
  // Call read(a,b,c), which may suspend, then resume on the restored Wasm VM stack.
  return new WebAssembly.Instance(callbackModule(), {"":{read:new WebAssembly.Suspending(read),resume}}).exports.next;
}

function streamHost(x) {
  let host = streamHosts.get(x);
  if (host) return host;
  const jobs = new Map(), table = x.__indirect_function_table;
  const next = suspendingCallback(async (id, ptr, ms) => {
      const job = jobs.get(id);
      job.sp = x.__stack_pointer.value;
      job.stack = new Uint8Array(x.memory.buffer.slice(job.sp, job.top));
      x.__stack_pointer.value = job.top;
      try {
        job.signal?.throwIfAborted();
        if (ptr === 0) {
          // A stream read always supplies a data pointer; sleep supplies the delay instead.
          let timer;
          try {
            await untilAbort(new Promise(resolve => { timer = setTimeout(resolve, ms); }), job.signal);
          } finally { clearTimeout(timer); }
          return;
        }
        const read = job.iterator.next();
        const result = await (job.signal ? untilAbort(read, job.signal) : read);
        job.done = Boolean(result.done);
        if (!job.done) {
          let bytes = result.value;
          if (!(bytes instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
          // Allocating the transfer buffer can grow and detach Wasm memory.
          if (bytes.buffer === x.memory.buffer) bytes = new Uint8Array(bytes);
          job.data = job.shell._allocBytes(bytes);
        }
        job.status = job.done ? 0 : 1;
      } catch {
        if (ptr === 0) { job.timerFailed = true; return; }
        job.status = -1;
        job.data = job.shell._allocBytes(encoder.encode("internal error"));
      }
    }, (id,p,n) => {
      const job = jobs.get(id);
      new Uint8Array(x.memory.buffer, job.sp, job.stack.length).set(job.stack);
      x.__stack_pointer.value = job.sp;
      job.stack = undefined;
      if (job.signal?.aborted || job.timerFailed) return -2;
      if (p === 0) return 0;
      if (job.data) {
        const v = new DataView(x.memory.buffer);
        v.setUint32(p,job.data.ptr,true); v.setUint32(n,job.data.len,true);
        job.data = undefined; // Rust now owns this allocation.
      }
      return job.status;
    });
  const slot = table.grow(1);
  table.set(slot,next);
  host = { jobs, slot, exec:WebAssembly.promising(x.safe_bash_exec_stream) };
  streamHosts.set(x,host);
  return host;
}

// One callback belongs to one execution fork; the host filesystem remains live during the call.
function bindExternalFs(shell,fs,options) {
  const namespace=fs[Symbol.for("@poe-code/safe-fs/path-namespace/v1")];
  let selectNamespace;
  if(namespace!==undefined){
    if(namespace===null || !Object.isFrozen(namespace) || typeof namespace.select!=="function")throw fsOperationError("EIO","namespace");
    const select=namespace.select,capture=select[Symbol.for("@poe-code/safe-fs/capture-path-namespace/v1")];
    selectNamespace=capture===undefined?select.bind(namespace):Reflect.apply(capture,select,[{signal:options.signal}]);
    if(typeof selectNamespace!=="function")throw fsOperationError("EIO","namespace");
  }
  const x=shell.exports, table=x.__indirect_function_table, top=x.__stack_pointer.value;
  const free=freeCommandSlots.get(x) ?? [];
  freeCommandSlots.set(x,free);
  const slot=free.pop() ?? table.grow(1), handles=new Map(), publications=new Map(), identityScopes=new Map(), closeErrors=[];
  let nextHandle=1;
  const discardTestStage=async obs=>{
    const stage=obs.testStage;
    if(!stage)return;
    delete obs.testStage;
    try{await stage.cleanup.remove();}finally{await stage.cleanup.close();}
  };
  const release=async()=>{
    table.set(slot,null);free.push(slot);
    const closed=await Promise.allSettled([...Array.from(publications.values(),discardTestStage),...Array.from(handles.values(),h=>h.close())]);
    for(const r of closed)if(r.status==="rejected")closeErrors.push(r.reason);
    if(closeErrors.length===1)throw closeErrors[0];
    if(closeErrors.length)throw new AggregateError(closeErrors,"Filesystem descriptor cleanup failed");
  };
  const scope=s=>{
    if(!s.identityScope || !["object","symbol"].includes(typeof s.identityScope) ||
      !Number.isSafeInteger(s.dev) || s.dev<0 || !Number.isSafeInteger(s.ino) || s.ino<0)return 0;
    if(!identityScopes.has(s.identityScope))identityScopes.set(s.identityScope,identityScopes.size+1);
    return identityScopes.get(s.identityScope);
  };
  const statBytes=s=>{
    const type=s.filesystemType;
    const fixed=new Uint8Array(new Float64Array([s.mode,s.size,s.atimeMs,s.mtimeMs,s.ctimeMs,s.birthtimeMs,
              s.revision,s.nlink,s.uid,s.gid,s.dev,s.ino,s.allocatedBytes,s.ioBlockSize,s.preferredIoBlockSize,type===undefined?0:type==="memory"?1:2,scope(s)]).buffer);
    if(typeof type!=="string" || !type || type==="memory")return fixed;
    const name=encoder.encode(type),bytes=new Uint8Array(fixed.length+name.length);
    bytes.set(fixed);bytes.set(name,fixed.length);return bytes;
  };
  const createStage=async(view,path,content,guard,metadata,name="file",parentDir=path.slice(0,path.lastIndexOf("/")),prefix=".zip")=>{
    const settings={signal:options.signal};
    for(let attempt=0;;attempt++){
      try{
        const temporary=parentDir+(name==="archive.zip"?"/"+prefix+"-"+(attempt+1):"/.safe-bash-stage-"+nextHandle++);
        if(temporary===path)continue;
        return await view.createStagedFile(temporary,name,content,
          {...settings,retainCleanup:true,...metadata,parent:guard.parent});
      }catch(error){if(error?.code!=="EEXIST" || attempt>=31)throw error;}
    }
  };
  const stageOutput=async(view,path,content,guard,metadata,writeStage)=>{
    const settings={signal:options.signal},stage=await createStage(view,path,content,guard,metadata);
    try{
      if(writeStage){
        if(!stage.writer)throw fsOperationError("ENOTSUP","createStagedFile",path);
        await writeStage(stage.writer);
      }
      const finished=stage.writer?{...stage,file:{...stage.file,stat:await stage.writer.finish(settings)}}:stage;
      if(guard.companions)await view.publishStagedFileSet(finished,path,{...settings,...guard});
      else await view.publishStagedFile(finished,path,{...settings,...guard});
    }finally{
      if(stage.cleanup){try{await stage.cleanup.remove();}finally{await stage.cleanup.close();}}
      else await view.removeStagedFile(stage);
    }
  };
  let stack,sp,result,status;
  try {
    table.set(slot,suspendingCallback(async ptr=>{
      sp=x.__stack_pointer.value;
      stack=new Uint8Array(x.memory.buffer.slice(sp,top));
      x.__stack_pointer.value=top;
      result=undefined;status=0;
      try {
        const view=new DataView(x.memory.buffer), word=at=>view.getUint32(ptr+at,true);
        const field=at=>new Uint8Array(x.memory.buffer,word(at),word(at+4));
        const op=decoder.decode(field(0)), path=decoder.decode(field(8));
        const flags=word(24), mode=word(28), settings={signal:options.signal};
        const start=word(16),length=word(20);
        const obs=(op==="publish" || op==="replaceWithBackup" || op==="replaceEntry" || op==="extractEntry" || op==="extractSymlink") && publications.get(flags);
        const chunked=op!=="extractSymlink" && length>65536 && obs?.retainedWriter && (op!=="publish" || obs.stagedMutation);
        // Rust owns the request bytes until this callback resumes. Stack storage
        // can be reused during suspension; heap views must be renewed after memory grows.
        const data=!chunked || start<top && start+length>sp ? field(16).slice() : undefined;
        const writeStage=chunked ? async writer=>{
          for(let offset=0;offset<length;offset+=65536){
            settings.signal?.throwIfAborted();
            const n=Math.min(65536,length-offset);
            const bytes=data?data.slice(offset,offset+n):new Uint8Array(x.memory.buffer,start+offset,n).slice();
            await writer.write(bytes,settings);
          }
        } : undefined;
        if(op==="forgetPublication"){
          const obs=publications.get(flags);
          if(obs?.testStage)await discardTestStage(obs);
          publications.delete(flags);return;
        }
        if(op!=="close" && op!=="removePublished")options.signal?.throwIfAborted();
        if(op==="namespace"){
          const root=selectNamespace(path);
          if(typeof root!=="string")throw fsOperationError("EIO",op,path);
          result=encoder.encode(root);return;
        }
        if(op==="inspectExtraction" || op==="inspectMoveDestination" || op==="inspectRm"){
          const caps=await fs.capabilitiesFor?.(path,op==="inspectRm"?settings:{...settings,create:true,...(op==="inspectMoveDestination" && {stagingAncestry:true})}) ?? fs.capabilities;
          const ancestors=[];
          for(let end=0;end>=0;end=path.indexOf("/",end+1)){
            const dir=path.slice(0,end)||"/",stat=await fs.lstat(dir,settings);
            if(stat.type!=="directory")throw fsOperationError("ENOTDIR",op,dir);
            ancestors.push({path:dir,stat});
          }
          let destination=null;
          try{destination=await fs.lstat(path,settings);}catch(error){if(error?.code!=="ENOENT")throw error;}
          if(op==="inspectMoveDestination" && destination){
            const source=publications.get(mode).expected;
            if(!destination.identityScope || !Number.isSafeInteger(destination.ino) || !Number.isSafeInteger(destination.dev))throw fsOperationError("ENOTSUP","mv",path);
            if(source.identityScope===destination.identityScope && source.dev===destination.dev && source.ino===destination.ino)throw fsOperationError("EBUSY","mv",path);
          }
          // Creating a missing move target only requires exclusive publication
          // under the observed parent. Overwriting an entry also binds its ancestry.
          const exclusiveMove=op==="inspectMoveDestination" && destination===null && !caps?.atomicStagingAncestry &&
            caps?.atomicFileStaging && caps.retainedStagingCleanup && caps.guardedStagingPublication;
          const id=nextHandle++, guard={...(!exclusiveMove && {ancestors}),parent:ancestors.at(-1).stat,destination};
          publications.set(id,{path,guard,caps,exclusiveMove,allowTrusted:!!flags,retainedWriter:caps?.retainedStagingWrite===true && (!flags || caps.retainedStagingCleanup===true)});
          const bytes=destination && statBytes(destination);
          if(op==="inspectRm"){
            const parent=statBytes(guard.parent);
            result=new Uint8Array(8+parent.length+(bytes?.length??0));
            const header=new DataView(result.buffer);header.setUint32(0,id,true);header.setUint32(4,parent.length,true);
            result.set(parent,8);if(bytes)result.set(bytes,8+parent.length);return;
          }
          result=new Uint8Array(4+(bytes?.length??0));new DataView(result.buffer).setUint32(0,id,true);
          if(bytes)result.set(bytes,4);
          return;
        }
        if(op==="prepareExtractionDirectory"){
          const obs=publications.get(flags);
          if(!obs?.guard || obs.path!==path)throw fsOperationError("EAGAIN",op,path);
          const {parent,destination:expected}=obs.guard,{caps}=obs;
          if(expected && caps?.permissions===false && caps.timestamps===false){result=statBytes(expected);return;}
          if(!fs.prepareDirectory || !obs.allowTrusted && !(caps?.atomicDirectoryMetadata || caps?.trustedOwnedStaging)){
            status=-1;result=encoder.encode(expected?(obs.allowTrusted?"extraction requires conditional metadata":"extraction metadata requires atomic entry conditions"):
              (obs.allowTrusted?"extraction requires conditional directory creation":"extraction requires atomic directory creation"));return;
          }
          const times=new DataView(data.buffer,data.byteOffset,data.byteLength),atime=times.getFloat64(0,true),mtime=times.getFloat64(8,true);
          const parentPath=obs.guard.ancestors.at(-1).path;
          const confined=fs.confineExtraction?await fs.confineExtraction([parentPath],settings):fs;
          const directory=await confined.prepareDirectory(path,{...settings,parent,expected,...(caps?.permissions!==false && {mode}),
            ...(caps?.timestamps!==false && Number.isFinite(atime) && {atimeMs:atime}),
            ...(caps?.timestamps!==false && Number.isFinite(mtime) && {mtimeMs:mtime})});
          obs.guard.destination=directory;result=statBytes(directory);return;
        }
        if(op==="retainRemoval" || op==="retainMoveFile"){
          const caps=await fs.capabilitiesFor?.(path,settings)??fs.capabilities;
          if(!caps?.atomicEntryRemoval || !fs.removeEntryConditional){
            if(op==="retainMoveFile")throw fsOperationError("ENOTSUP","removeEntryConditional",path);
            status=-1;result=encoder.encode("ZIP move requires atomic conditional source removal");return;
          }
          const parentPath=await fs.realpath(path.slice(0,path.lastIndexOf("/"))||"/",settings);
          const canonical=(parentPath==="/"?"":parentPath)+path.slice(path.lastIndexOf("/"));
          const parent=await fs.lstat(parentPath,settings),expected=await fs.lstat(canonical,settings);
          if(op==="retainMoveFile" && expected.type!=="file")throw fsOperationError("ENOTSUP","mv",path);
          if(parent.type!=="directory" || !Number.isSafeInteger(expected.revision) ||
            [parent,expected].some(s=>(!s.identityScope || !["symbol","object"].includes(typeof s.identityScope)) ||
              !Number.isSafeInteger(s.dev) || s.dev<0 || !Number.isSafeInteger(s.ino) || s.ino<0)){
            if(op==="retainMoveFile")throw fsOperationError("ENOTSUP","mv",path);
            status=-1;result=encoder.encode("ZIP move requires known source identity and revision");return;
          }
          const id=nextHandle++,p=statBytes(parent),e=statBytes(expected);
          publications.set(id,{path:op==="retainMoveFile"?path:canonical,parent,expected});
          if(op==="retainMoveFile"){
            result=new Uint8Array(4+e.length);new DataView(result.buffer).setUint32(0,id,true);result.set(e,4);return;
          }
          result=new Uint8Array(16+p.length+e.length);const v=new DataView(result.buffer);
          v.setUint32(0,id,true);v.setUint32(4,scope(parent),true);v.setUint32(8,scope(expected),true);
          v.setUint32(12,p.length,true);result.set(p,16);result.set(e,16+p.length);return;
        }
        if(op==="checkMoveRead"){
          const {expected,path}=publications.get(flags);
          for(const current of [await handles.get(mode).stat(settings),await fs.lstat(path,settings)]){
            if(["identityScope","dev","ino","revision","type","size","mode","nlink","mtimeMs","ctimeMs"].some(key=>current[key]!==expected[key])){
              throw fsOperationError("EBUSY","mv",path);
            }
          }
          return;
        }
        if(op==="removeRetained"){
          const {path:canonical,parent,expected}=publications.get(flags);
          let entry=expected;
          if(mode && Number.isSafeInteger(expected.revision+mode)){
            const now=await fs.lstat(canonical,settings);
            if(now.type===expected.type && now.dev===expected.dev && now.ino===expected.ino &&
              now.identityScope===expected.identityScope && now.revision===expected.revision+mode)entry=now;
          }
          await fs.removeEntryConditional(canonical,{...settings,parent,expected:entry});return;
        }
        if(op==="removeObserved"){
          const obs=publications.get(flags);
          if(obs?.path!==path || !obs.guard.destination)throw fsOperationError("EAGAIN","rm",path);
          const {parent,destination:expected,ancestors}=obs.guard;
          if(expected.type==="directory")throw fsOperationError("EISDIR","rm",path);
          const method=obs.caps?.atomicEntryRemoval?"removeEntryConditional":
            expected.type==="file" && obs.caps?.atomicFileMutation?"removeFileConditional":"rm";
          if(typeof fs[method]!=="function" || obs.caps?.remove===false)throw fsOperationError("ENOTSUP","rm",path);
          await fs[method](path,{...settings,parent,expected,ancestors,...(method==="rm" && {recursive:false,force:!!mode})});return;
        }
        if(op==="removeExtraction"){
          const obs=publications.get(flags);
          if(!obs?.guard?.destination || obs.path!==path)throw fsOperationError("EAGAIN",op,path);
          const {destination:expected,parent}=obs.guard;
          const remove=expected.type==="file"?"removeFileConditional":"removeEntryConditional";
          if(!fs[remove]){status=-1;result=encoder.encode("extraction requires conditional "+(expected.type==="file"?"file":"entry")+" removal");return;}
          await fs[remove](path,{...settings,expected,parent});return;
        }
        if(op==="replaceWithBackup"){
          const backup=publications.get(mode);
          if(!obs?.guard?.destination || obs.path!==path || !backup?.guard)throw fsOperationError("EAGAIN",op,path);
          if(!fs.publishStagedFileSet || !obs.caps?.atomicStagedFileBackup || !backup.caps?.atomicStagedFileBackup ||
             !obs.caps.atomicStagingAncestry || !obs.caps.retainedStagingCleanup)throw fsOperationError("ENOTSUP",op,path);
          const companions=[{path:backup.path,expected:backup.guard.destination,remove:false,keepDestination:true}];
          await stageOutput(fs,path,{type:"file",data:chunked?new Uint8Array():data},{...obs.guard,companions},
            {mode:obs.guard.destination.mode&0o7777},writeStage);
          return;
        }
        if(op==="extractEntry" || op==="extractSymlink"){
          if(!obs?.guard || obs.path!==path)throw fsOperationError("EAGAIN",op,path);
          const {caps,guard}=obs;
          const staging=!!(caps?.atomicFileStaging || caps?.trustedOwnedStaging) && fs.createStagedFile && fs.publishStagedFile && fs.removeStagedFile;
          if(obs.allowTrusted && (!staging || !(caps.atomicStagingAncestry || caps.trustedOwnedStaging && caps.trustedStagingAncestry))){
            status=-1;result=encoder.encode("extraction requires atomic staging and ancestry verification");return;
          }
          if(!staging){
            status=-1;result=encoder.encode("extraction requires atomic owned file staging");return;
          }
          if(!obs.exclusiveMove && !obs.allowTrusted && !caps.atomicStagingAncestry){status=-1;result=encoder.encode("extraction requires atomic staging ancestry verification");return;}
          if(op==="extractSymlink"){
            if(!fs.symlink || caps.symlinks===false){status=-1;result=encoder.encode("filesystem does not support symlinks");return;}
            await stageOutput(fs,path,{type:"symlink",target:decoder.decode(data)},guard,{retainCleanup:caps.retainedStagingCleanup===true});
            return;
          }
          const atime=view.getFloat64(ptr+32,true),mtime=view.getFloat64(ptr+40,true);
          await stageOutput(fs,path,{type:"file",data:chunked?new Uint8Array():data},guard,{retainCleanup:caps.retainedStagingCleanup===true,
            ...(caps.permissions!==false && {mode}),...(caps.timestamps!==false && {
              ...(Number.isFinite(atime) && {atimeMs:atime}),...(Number.isFinite(mtime) && {mtimeMs:mtime})})},writeStage);
          return;
        }
        if(op==="observePatch"){
          result=new Uint8Array(4);
          if(typeof fs.confineExtraction!=="function")return;
          const caps=fs.capabilitiesFor?await fs.capabilitiesFor(path,settings):fs.capabilities;
          if(!caps?.atomicFileMutation || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeFileConditional)return;
          const stage=caps.retainedStagingWrite && caps.retainedStagingCleanup && caps.atomicStagedFileMutation;
          if(!stage && !fs.writeFileConditional)return;
          const directory=path.slice(0,path.lastIndexOf("/"))||"/";
          let root=directory;
          for(;;){
            try{await fs.lstat(root,settings);break;}
            catch(error){if(root==="/" || error?.code!=="ENOENT")throw error;}
            root=root.slice(0,root.lastIndexOf("/"))||"/";
          }
          const view=await fs.confineExtraction([root],settings);
          let expected=null;
          try{expected=await view.lstat(path,settings);}catch(error){if(error?.code!=="ENOENT")throw error;}
          const parent=root===directory?await view.lstat(root,settings):undefined;
          const id=nextHandle++;
          publications.set(id,{path,view,expected,parent,root,directory,stage});
          new DataView(result.buffer).setUint32(0,id,true);return;
        }
        if(op==="patchFile"){
          const obs=publications.get(flags);
          if(!obs || obs.path!==path)throw fsOperationError("EAGAIN",op,path);
          const {view,expected}=obs;
          let parent=obs.parent;
          if(!mode){
            if(!parent || !expected)throw fsOperationError("ENOENT",op,path);
            await view.removeFileConditional(path,{...settings,parent,expected});return;
          }
          if(!parent){
            let current=obs.root;
            for(const part of obs.directory.slice(current.length).split("/").filter(Boolean)){
              current=(current==="/"?"":current)+"/"+part;
              try{await view.mkdir(current,settings);}catch(error){if(error?.code!=="EEXIST")throw error;}
              parent=await view.lstat(current,settings);
              if(parent.type!=="directory")throw fsOperationError("ENOTDIR",op,current);
            }
          }
          if(expected?.size===data.length){
            const current=await view.readFile(path,{...settings,maxBytes:data.length});
            if(current.length===data.length && current.every((byte,i)=>byte===data[i])){
              const stat=await view.lstat(path,settings);
              if(["identityScope","opaqueIdentity","opaqueVersion","dev","ino","revision","mode","size","nlink","mtimeMs","ctimeMs"].some(key=>stat[key]!==expected[key]))
                throw fsOperationError("EAGAIN",op,path);
              return;
            }
          }
          if(obs.stage)await stageOutput(view,path,{type:"file",data},{parent,destination:expected,...(expected && {preserveIdentity:true})},
            expected?{atimeMs:expected.atimeMs}:{});
          else await view.writeFileConditional(path,data,{...settings,parent,expected,...(expected && {mode:expected.mode&0o7777})});
          return;
        }
        if(op==="observePublication"){
          if(flags===3){
            const dir=await fs.realpath(path,settings),parent=await fs.lstat(dir,settings);
            if(parent.type!=="directory" || parent.identityScope==null)throw fsOperationError("ENOTSUP",op,path);
            const id=nextHandle++;publications.set(id,{dir,parent,name:path});
            result=new Uint8Array(4);new DataView(result.buffer).setUint32(0,id,true);return;
          }
          const caps=fs.capabilitiesFor?await fs.capabilitiesFor(path,{...settings,create:true,...(flags===2 && {stagingResolution:true})}):fs.capabilities;
          const write=caps?.atomicFileMutation && typeof fs.writeFileConditional==="function";
          const stream=caps?.atomicFilePublication && typeof fs.publishFileConditional==="function";
          result=new Uint8Array(4);
          if(flags===2){
            if(!caps?.atomicFileStaging || !caps.retainedStagingCleanup || !caps.guardedStagingPublication ||
              !fs.prepareStagingResolution || !fs.createStagedFile || !fs.publishStagedFile)return;
            const resolution=await fs.prepareStagingResolution(path,settings), id=nextHandle++;
            publications.set(id,{path,resolution,write,stagedMutation:caps.atomicStagedFileMutation===true,retainedWriter:caps.retainedStagingWrite===true});
            new DataView(result.buffer).setUint32(0,id,true);return;
          }
          if(flags ? !write || typeof fs.removeFileConditional!=="function" : !write && !stream)return;
          const parent=await fs.stat(path.slice(0,path.lastIndexOf("/"))||"/",settings);
          let expected;
          try{expected=await fs.lstat(path,settings);}catch(error){if(error?.code!=="ENOENT")throw error;expected=null;}
          if(expected && expected.type!=="file")throw fsOperationError("EINVAL","publish",path);
          const id=nextHandle++;
          publications.set(id,{path,parent,expected,write});
          new DataView(result.buffer).setUint32(0,id,true);return;
        }
        if(op==="stageForTest" || op==="stageVolume"){
          const obs=publications.get(flags),r=obs?.resolution;
          if(!r || op==="stageForTest" && path!==obs.path || obs.testStage)throw fsOperationError("ENOTSUP",op,path);
          r.validate();
          const temp=mode?publications.get(mode):undefined;
          if(mode && !temp?.parent)throw fsOperationError("EAGAIN",op,path);
          const stage=await createStage(fs,r.path,{type:"file",data},temp??r,{mode:r.destination?r.destination.mode&0o7777:0o644},
            "archive.zip",temp?(temp.dir==="/"?"":temp.dir):undefined,op==="stageVolume"?path:".zip");
          obs.temp=temp;
          obs.testStage=stage;
          if(stage.writer)obs.testStage={...stage,file:{...stage.file,stat:await stage.writer.finish(settings)}};
          result=encoder.encode(stage.file.path);return;
        }
        if(op==="validateVolume" || op==="discardCheckedArchive"){
          const obs=publications.get(flags),stage=obs?.testStage;
          if(!stage)throw fsOperationError("EAGAIN",op,path);
          if(op==="validateVolume" || mode){
            obs.resolution.validate();
            if(obs.temp && await fs.realpath(obs.temp.name,settings)!==obs.temp.dir)throw fsOperationError("EAGAIN",op,path);
            const actual=await fs.lstat(stage.file.path,settings),expected=stage.file.stat;
            if(["identityScope","opaqueIdentity","opaqueVersion","dev","ino","revision","mode","size","nlink","mtimeMs","ctimeMs"].some(k=>actual[k]!==expected[k]))
              throw fsOperationError("EAGAIN",op,stage.file.path);
          }
          if(op==="discardCheckedArchive")await discardTestStage(obs);
          return;
        }
        if(op==="replaceEntry" || op==="publish" && publications.get(flags)?.resolution){
          const obs=publications.get(flags);
          if(!obs?.resolution || obs.path!==path)throw fsOperationError("EAGAIN",op,path);
          const r=obs.resolution;
          r.validate();
          if(obs.temp && await fs.realpath(obs.temp.name,settings)!==obs.temp.dir)throw fsOperationError("EAGAIN",op,path);
          const inPlace=op==="publish";
          if(inPlace){
            if(!r.destination || r.destination.nlink<=1)throw fsOperationError("EAGAIN",op,path);
            if(!obs.write)throw fsOperationError("ENOTSUP",op,path);
            if(!obs.stagedMutation){
              if(obs.testStage || !fs.confineExtraction)throw fsOperationError("ENOTSUP",op,path);
              const confined=await fs.confineExtraction([r.path.slice(0,r.path.lastIndexOf("/"))||"/"],{...settings,commitGuard:r.validate});
              await confined.writeFileConditional(r.path,data,{...settings,parent:r.parent,expected:r.destination});return;
            }
          }
          const guard={parent:r.parent,destination:r.destination,ancestors:r.ancestors,commitGuard:r.validate,
            ...(inPlace && {preserveIdentity:true})};
          if(obs.testStage)await fs.publishStagedFile(obs.testStage,r.path,{...settings,...guard});
          else await stageOutput(fs,r.path,{type:"file",data:chunked?new Uint8Array():data},guard,{mode:inPlace?r.destination.mode&0o7777:mode},writeStage);
          return;
        }
        if(op==="publicationAlias"){
          const observation=publications.get(flags), dst=observation.expected;
          let distinct=!dst;
          if(dst){
            if(typeof fs.compareEntry==="function")distinct=(await fs.compareEntry(path,fs,observation.path,settings))==="distinct";
            else {
              const src=await fs.stat(path,settings);
              distinct=src.identityScope!==undefined && src.identityScope===dst.identityScope && (
                (src.opaqueIdentity!==undefined && dst.opaqueIdentity!==undefined && src.opaqueIdentity!==dst.opaqueIdentity) ||
                (src.dev!==undefined && dst.dev!==undefined && src.ino!==undefined && dst.ino!==undefined && (src.dev!==dst.dev || src.ino!==dst.ino)));
            }
          }
          result=Uint8Array.of(Number(!distinct));return;
        }
        if(op==="publish" || op==="removePublished"){
          const obs=publications.get(flags);
          if(!obs || obs.path!==path)throw fsOperationError("EAGAIN",op,path);
          const guard={parent:obs.parent,expected:obs.expected};
          if(op==="publish"){
            obs.expected=obs.write?await fs.writeFileConditional(path,data,{...guard,...settings})
              :await fs.publishFileConditional(path,(async function*(){yield data;})(),{...guard,...settings,maxBytes:data.length});
          }else{
            try{await fs.removeFileConditional(path,guard);result=Uint8Array.of(1);}
            catch(error){if(error?.code!=="ENOENT" && error?.code!=="EAGAIN")throw error;result=Uint8Array.of(0);}
          }
          return;
        }
        const h=handles.get(flags);
        if(op==="close"){
          handles.delete(flags);
          try{await h.close();}catch(e){closeErrors.push(e);if(mode)throw e;}
          return;
        }
        if(op==="rangeRead"){
          const at=Number(new DataView(data.buffer,data.byteOffset).getBigUint64(0,true));
          if(!Number.isSafeInteger(at))throw fsOperationError("EOVERFLOW","read");
          const bytes=await h.read(at,mode,settings);
          if(!(bytes instanceof Uint8Array) || bytes.length>mode)throw fsOperationError("EIO","read");
          result=bytes;return;
        }
        if(op==="seekEnd"){
          if(typeof h.seekEnd!=="function")throw fsOperationError("ENOTSUP",op);
          const end=await h.seekEnd(settings);
          if(typeof end!=="bigint" || end<0n || end>0xffffffffffffffffn)throw fsOperationError("EOVERFLOW",op);
          result=new Uint8Array(8);new DataView(result.buffer).setBigUint64(0,end,true);return;
        }
        if(op==="pread"){
          const b=new Uint8Array(mode), at=new DataView(data.buffer,data.byteOffset).getUint32(0,true);
          const n=await h.read(b,at,settings);
          if(!Number.isSafeInteger(n)||n<0||n>b.length)throw fsOperationError("EIO","read");
          result=b.subarray(0,n);return;
        }
        if(op==="pwrite"){
          let pos=0;
          while(pos<data.length){
            const n=await h.write(data.subarray(pos),mode===0xffffffff?null:mode+pos,settings);
            if(!Number.isSafeInteger(n)||n<=0||n>data.length-pos)throw fsOperationError("EIO","write");
            pos+=n;
          }
          return;
        }
        if(op==="ftruncate"){await h.truncate(mode,settings);return;}
        if(op==="beginExclusive" || op==="finishExclusive"){
          const caps=await fs.capabilitiesFor?.(path,{...settings,creation:"exclusive"}) ?? fs.capabilities;
          if(caps?.readOnly)throw fsOperationError("EROFS","writeFile",path);
          if(caps?.exclusiveCreate!==true || !fs.writeFile || mode!==0o644 && caps.permissions!==true)
            throw fsOperationError("ENOTSUP","writeFile",path);
          if(op==="beginExclusive"){
            try{await fs.lstat(path,settings);}catch(error){if(error?.code==="ENOENT")return;throw error;}
            throw fsOperationError("EEXIST","writeFile",path);
          }
          await fs.writeFile(path,data,{...settings,flag:"wx",...(caps.permissions!==false && {mode})});return;
        }
        if(op==="mktemp"){
          const caps=await fs.capabilitiesFor?.(path,{...settings,creation:"exclusive"}) ?? fs.capabilities;
          if(caps?.readOnly)throw fsOperationError("EROFS",op,path);
          if(caps?.permissions!==true)throw fsOperationError("ENOTSUP",op,path);
          if(flags)await fs.mkdir(path,{...settings,recursive:false,mode,exactMode:true});
          else await fs.writeFile(path,data,{...settings,mode,flag:"wx"});
          return;
        }
        if(op==="canLink"){
          const caps=await fs.capabilitiesFor?.(path,settings) ?? fs.capabilities;
          result=Uint8Array.of(Number(caps?.hardlinks===true && typeof fs.link==="function"));return;
        }
        if(op==="canOpen" || op==="open" || op==="openReadFile"){
          const creation=flags===4?"exclusive":flags===0||mode===0xffffffff?"never":"ifMissing";
          const retained=op==="openReadFile";
          const caps=fs.capabilitiesFor?await fs.capabilitiesFor(path,retained?settings:{...settings,creation}):fs.capabilities;
          const supported=typeof fs.open==="function" && caps?.open===true;
          if(op==="canOpen"){result=Uint8Array.of(Number(supported));return;}
          if(retained && (!fs.openReadFile || caps?.retainedRead!==true))throw fsOperationError("ENOTSUP",op,path);
          if(!retained && !supported)return;
          const descriptor=retained?await fs.openReadFile(path,{...settings,allowDirectory:!!flags}):await fs.open(path,{...settings,creation,access:flags===0?"read":flags===5?"readwrite":"write",
            truncate:flags===2,append:flags===3,...(mode===0xffffffff?{}:{mode,exactMode:true})});
          const id=nextHandle++;
          handles.set(id,descriptor);
          result=new Uint8Array(4);new DataView(result.buffer).setUint32(0,id,true);return;
        }
        if(op==="unlink" && typeof fs.unlink!=="function" && fs.removeFileConditional) {
          const caps=await fs.capabilitiesFor?.(path,settings) ?? fs.capabilities;
          if(!caps?.atomicFileMutation)throw fsOperationError("ENOTSUP",op,path);
          const parent=await fs.lstat(posix.dirname(path),settings),expected=await fs.lstat(path,settings);
          if(expected.type!=="file")throw fsOperationError(expected.type==="directory"?"EISDIR":"ENOTSUP",op,path);
          await fs.removeFileConditional(path,{...settings,parent,expected});return;
        }
        if(op!=="fstat" && typeof fs[op]!=="function")throw fsOperationError("ENOTSUP",op,path);
        switch(op) {
          case "stat":case "lstat":case "fstat":{
            const s=op==="fstat"?await h.stat(settings):await fs[op](path,settings);
            result=statBytes(s);
            break;
          }
          case "readFile":result=await fs.readFile(path,{...settings,maxBytes:flags});break;
          case "writeFile":case "appendFile":{
            if(flags){await fs.writeFile(path,data,{...settings,mode,flag:"wx"});break;}
            const caps=await fs.capabilitiesFor?.(path,settings) ?? fs.capabilities;
            await fs[op](path,data,caps?.permissions===false?settings:{...settings,mode:0o644});break;
          }
          case "mkdir":{
            const caps=await fs.capabilitiesFor?.(path,{...settings,create:true}) ?? fs.capabilities;
            if(caps?.permissions===false && !(flags&2))throw fsOperationError("ENOTSUP",op,path);
            await fs.mkdir(path,{...settings,recursive:!!(flags&1),...(caps?.permissions!==false && {mode,exactMode:true})});break;
          }
          case "rm":await fs.rm(path,{...settings,recursive:!!flags});break;
          case "unlink":case "rmdir":await fs[op](path,settings);break;
          case "rename":{
            const destination=decoder.decode(data);
            if(flags){
              const caps=await fs.capabilitiesFor?.(destination,{...settings,create:true}) ?? fs.capabilities;
              settings.signal?.throwIfAborted();
              if(caps?.atomicRenameNoReplace!==true)throw fsOperationError("ENOTSUP",op,path,destination);
            }
            await fs.rename(path,destination,{...settings,noReplace:!!flags});
            break;
          }
          case "link":case "symlink":await fs[op](path,decoder.decode(data),settings);break;
          case "readlink":result=encoder.encode(await fs.readlink(path,settings));break;
          case "readdir":result=encoder.encode((await fs.readdir(path,settings)).map(e=>typeof e==="string"?e:e.name).join("\0"));break;
          case "chmod":await fs.chmod(path,mode,settings);break;
          case "utimes":{
            const times=new DataView(data.buffer,data.byteOffset,data.byteLength);
            await fs.utimes(path,times.getFloat64(0,true),times.getFloat64(8,true),settings);break;
          }
          default:throw fsOperationError("ENOTSUP",op,path);
        }
      }catch(error){
        status=-1;
        const known=error?.[FS_ERROR_BRAND] === true;
        result=encoder.encode(options.signal?.aborted?"Execution aborted: cancelled":known?error.message:"internal error");
        if(!known && !options.signal?.aborted){try{options.onInternalError?.(error);}catch{ /* Keep observer failures private. */ }}
      }
    },(_ptr,reply)=>{
      new Uint8Array(x.memory.buffer,sp,stack.length).set(stack);x.__stack_pointer.value=sp;
      stack=undefined;
      if(result?.length){
        const bytes=shell._allocBytes(result), view=new DataView(x.memory.buffer);
        view.setUint32(reply,bytes.ptr,true);view.setUint32(reply+4,bytes.len,true);
      }
      result=undefined;return status;
    }));
    if(x.safe_bash_bind_fs(shell.sessionId,slot,namespace!==undefined,typeof fs.symlink!=="function" || fs.capabilities?.symlinks===false)!==0)throw new Error("Could not bind the execution filesystem");
    return release;
  }catch(error){void release();throw error;}
}

// Each executing fork leases its own slots: concurrent handlers can resume in any order.
const freeCommandSlots = new WeakMap();
function bindHostCommands(shell, definitions, commandContract, validatePath, diagnostics, bindFileOutputBudget, fs, supportsOpen, options, middleware, composeMiddleware, ownedDeviceFs) {
  const x = shell.exports, table = x.__indirect_function_table;
  const free = freeCommandSlots.get(x) ?? [];
  freeCommandSlots.set(x, free);
  const slots = [], cleanupFailures = [], top = x.__stack_pointer.value;
  const executionSignal = options.signal ?? new AbortController().signal, childSignals = [];
  const {onInternalError} = options;
  const terminals = middleware.length ? new Map(definitions.map(d=>[d.name,d])) : undefined;
  const backing = fs.capabilities;
  const capabilities = Object.freeze({open:supportsOpen, ...Object.fromEntries(
    ["read", "write", "append", "stat", "access", "realpath", "exclusiveCreate", "retainedRead", "streamingRead", "atomicFileMutation", "atomicDirectoryMetadata", "atomicFileStaging", "atomicStagingAncestry", "retainedStagingWrite", "retainedStagingCleanup"].map(key => [key, backing[key]]))});

  let deviceShell;
  const release = () => {
    const disposing = deviceShell instanceof Promise
      ? deviceShell.then(shell => shell.dispose(), () => {}) : deviceShell?.dispose();
    for (const slot of slots) { table.set(slot, null); free.push(slot); }
    if (!executionSignal.aborted && cleanupFailures.length) {
      if (cleanupFailures.length === 1) throw cleanupFailures[0];
      throw new AggregateError(cleanupFailures, "Invocation cleanup failed");
    }
    return disposing;
  };
  try {
    for (const definition of middleware.length ? [...definitions,null] : definitions) {
      const jobs = new Map();
      const slot = free.pop() ?? table.grow(1);
      slots.push(slot);
      table.set(slot, suspendingCallback(async (ptr, len, reply) => {
        const header = new DataView(x.memory.buffer), status = header.getInt32(reply+72,true);
        const job = status === -1 ? {} : jobs.get(ptr);
        const sp = x.__stack_pointer.value;
        job.sp = sp; job.stack = new Uint8Array(x.memory.buffer.slice(sp,top));
        x.__stack_pointer.value = top;
        job.next = Promise.withResolvers();
        if (status !== -1) {
          childSignals.pop();
          const start = header.getUint32(reply+64,true), size = header.getUint32(reply+68,true);
          const bytes = new Uint8Array(x.memory.buffer,start,size).slice();
          job.resume(status,bytes,header.getUint32(reply+20,true),header.getUint32(reply+28,true));
          return job.next.promise;
        }
        const signal = childSignals.at(-1) ?? executionSignal;
        jobs.set(ptr,job);
        const packet = new Uint8Array(x.memory.buffer, ptr, len).slice();
        let remaining = header.getUint32(reply + 20, true);
        const sharedOutput = header.getUint32(reply + 24, true) !== 0;
        let remainingFsOps = header.getUint32(reply + 28, true);
        const maxComponents = header.getUint32(reply + 32, true), maxInput = header.getUint32(reply+84,true);
        const creationMode = header.getUint32(reply + 40, true);
        const stdinIsDefault = header.getUint32(reply + 52, true) !== 0;
        const access = header.getUint32(reply + 56, true);
        const directoryMode = header.getUint32(reply + 60, true);
        const badDescriptor = () => Object.assign(new diagnostics.PublicDiagnostic("Bad file descriptor"), {code:"EBADF"});
        let active = true, outputOpen = true, cleanups, handles, stages, fsOps = 0, consumed = 0, code = 1;
        let fileOutput = 0;
        const streams = [[], []], credits = [0,0], unpaid = [0,0];
        let tail = Promise.resolve(), busy, children, stopped, nativeFlow;
        const run = async () => { try {
          const view = new DataView(packet.buffer);
          let offset = 0;
          const word = () => { const n = view.getUint32(offset, true); offset += 4; return n; };
          const field = () => { const n = word(); offset += n; return packet.subarray(offset - n, offset); };
          const argc = word(), envc = word(), explicit = word(), cwd = decoder.decode(field());
          const command = definition?.name ?? decoder.decode(field());
          const argv0 = explicit ? decoder.decode(field()) : undefined;
          const argumentValues = commandContract.createCommandArguments(Array.from({length:argc}, field));
          const env = Object.fromEntries(Array.from({length:envc}, () => [decoder.decode(field()),decoder.decode(field())]));
          const initialEnv = definition ? undefined : {...env};
          const check = (open = active) => { signal.throwIfAborted(); if (stopped) throw stopped; if (!open) throw new Error("Command has finished"); };
          const chargeFs = () => {
            if (fsOps >= remainingFsOps) { code = -5; throw new ShellLimitError("maxFileSystemOperations"); }
            fsOps++;
          };
          const admitPath = (path, settings) => {
            check();
            settings?.signal?.throwIfAborted();
            if (code === -3) throw new ShellLimitError("maxOutputBytes");
            chargeFs();
            validatePath(path, maxComponents);
          };
          const external = ownedDeviceFs !== undefined;
          const deviceKind = (p,follow) => {
            const call=tail.then(()=>exchange([Uint8Array.of(follow?133:134,0,0,0),encoder.encode(p)],signal));
            tail=call.catch(()=>{});
            return call.then(({status,bytes})=>{
              if(status===4){const text=decoder.decode(bytes);throw fsErr(text.split(":",1)[0],text);}
              return status;
            });
          };
          const mutable = async p => {
            if(external && await deviceKind(p,false))throw fsOperationError("EBUSY",undefined,p);
          };
          const route = async (operation,p,args,follow=true) => {
            if(!external)return fs[operation](p,...args);
            const kind=await deviceKind(p,follow);
            if(kind===0)return fs[operation](p,...args);
            const canonical=[null,"/dev/null","/dev","/"][kind];
            if(operation==="readdir" && kind!==1){
              const limit=args[0]?.maxEntries;
              if(limit!==undefined && limit!==Infinity && (!Number.isSafeInteger(limit) || limit<0))throw fsOperationError("EINVAL","readdir",p);
              let entries;
              try{entries=await fs.readdir(canonical,...args);}catch(e){
                if(e?.code!=="ENOENT" && e?.code!=="ENOTDIR")throw e;
                entries=[];
              }
              const names=new Map();
              for(const e of entries){
                const name=typeof e==="string"?e:e.name;
                if(name==="." || name==="..")continue;
                if(!name || name.includes("/") || name.includes("\0"))throw fsOperationError("EIO","readdir",p);
                names.set(name,e);
              }
              const name=kind===2?"null":"dev";
              names.set(name,{name,type:kind===2?"character":"directory"});
              if(limit!==undefined && names.size>limit)throw fsOperationError("EFBIG","readdir",p);
              return [...names.values()];
            }
            if(["rm","unlink","chmod","writeFileConditional","removeFileConditional","prepareDirectory"].includes(operation))throw fsOperationError("EBUSY",undefined,p);
            if(kind===3 && ["stat","lstat","access","openReadFile","readFile","readStream","open","realpath","readlink"].includes(operation))
              return fs[operation](canonical,...args);
            const virtual=ownedDeviceFs ?? (await (deviceShell ??= createRustWasmBash({cwd:"/"}))).fs;
            return virtual[operation](canonical,...args);
          };
          const write = async (operation, path, data, settings) => {
            admitPath(path, settings);
            const options = {...settings};
            if (options.mode === undefined) options.mode = creationMode;
            check();
            return route(operation,path,[data,options]);
          };
          const openHandle = async (operation, path, settings) => {
            admitPath(path, settings);
            if (operation === "open" && settings?.mode === undefined && ["ifMissing","exclusive"].includes(settings?.creation)) {
              settings = {...settings, mode:creationMode};
            }
            const opening = route(operation,path,[settings],operation!=="open" || settings?.creation!=="exclusive");
            let closing;
            const close = () => closing ??= opening.then(handle => handle.close(), () => {}).finally(() => handles.delete(close));
            (handles ??= new Set()).add(close);
            try {
              const handle = await opening;
              check();
              const scoped = {close, ...(handle.capabilities && {capabilities:handle.capabilities})};
              // The last argument is the operation signal; close is always available for cleanup.
              for (const [name, index] of [["read",2],["write",2],["stat",0],["seekEnd",0],["getPosition",0],["probeRead",0],["truncate",1],["sync",1]]) {
                if (typeof handle[name] !== "function") continue;
                scoped[name] = async (...args) => {
                  if (busy) await busy;
                  check();
                  const opts = args[index];
                  opts?.signal?.throwIfAborted();
                  if (closing) throw fsOperationError("EBADF");
                  admitPath(path, opts);
                  args[index] = {...opts,signal:opts?.signal && opts.signal !== signal ? AbortSignal.any([signal,opts.signal]) : signal};
                  const result = await handle[name](...args);
                  check();
                  return result;
                };
              }
              return scoped;
            } catch (error) { await close(); throw error; }
          };
          const pathProfile = (path, settings) => {
            const intent = settings?.create === true ? 2 : settings?.create === false ? 3
                : (settings?.stagingResolution ? !settings.followFinalSymlink : settings?.creation === "exclusive") ? 1 : 0;
            // Use the owning session: the executing fork is suspended in its handler.
            const bash = fs.bash, p = bash._allocBytes(encoder.encode(path));
            try {
              const kind = x.safe_bash_command_fs_profile(bash.sessionId,p.ptr,p.len,intent);
              if (kind === -1) throw new Error("Wasm session unavailable");
              if (kind < 0) throw readOperationError(decoder.decode(new Uint8Array(x.memory.buffer,x.safe_bash_output_ptr(bash.sessionId),-kind)));
              return kind;
            } finally { bash._freeBytes(p); }
          };
          const stageControls = settings => {
            const opts = {...settings};
            opts.signal = opts.signal && opts.signal !== signal ? AbortSignal.any([signal,opts.signal]) : signal;
            return opts;
          };
          const stageEntry = ({path,stat}) => {
            validatePath(path,maxComponents);
            return {path,stat:{...stat}};
          };
          const stageReceipt = receipt => ({parent:stageEntry(receipt.parent),directory:stageEntry(receipt.directory),file:stageEntry(receipt.file)});
          const commandFs = {
            capabilities,
            async capabilitiesFor(path, settings) {
              admitPath(path, settings);
              const follow = settings?.stagingResolution ? settings.followFinalSymlink===true : settings?.create!==undefined || settings?.creation!=="exclusive";
              const kind = external ? await deviceKind(path,follow) : pathProfile(path, settings);
              if(external && (kind===2 || kind===3) && settings?.create!==undefined)throw fsOperationError("EISDIR","capabilitiesFor",path);
              if(external && (kind===0 || kind===3)){
                const actual=await fs.capabilitiesFor?.(path,settings) ?? backing;
                return Object.freeze(Object.fromEntries(Object.keys(capabilities).map(key=>[key,actual[key]])));
              }
              const directory = kind === 2, regular = kind === 0;
              return Object.freeze({...capabilities, write:!directory, append:!directory, exclusiveCreate:!directory,
                retainedStagingWrite:regular && capabilities.retainedStagingWrite, retainedStagingCleanup:regular && capabilities.retainedStagingCleanup,
                atomicFileStaging:regular && capabilities.atomicFileStaging, atomicStagingAncestry:regular && capabilities.atomicStagingAncestry,
                atomicFileMutation:regular && capabilities.atomicFileMutation, atomicDirectoryMetadata:regular && capabilities.atomicDirectoryMetadata, open:(external && kind===1 || supportsOpen) && !directory, retainedRead:!directory, streamingRead:!directory, permissions:regular, readdir:kind !== 1, readlink:regular,
                mkdir:regular, recursiveMkdir:regular, remove:regular, removeDirectory:regular, recursiveRemove:regular,
                rename:regular, atomicRename:regular, atomicRenameNoReplace:regular, symlinks:regular});
            },
            async copyFile(source, destination, settings) {
              admitPath(source, settings);
              validatePath(destination, maxComponents);
              // A backing copy cannot atomically resolve both paths through the shell's device overlay.
              if (external && await deviceKind("/", false)) throw fsOperationError("ENOTSUP", "copyFile", source, destination);
              const controls = stageControls(settings);
              controls.signal.throwIfAborted();
              return fs.copyFile(source, destination, controls);
            },
            async rename(source, destination, settings) {
              admitPath(source, settings);
              validatePath(destination, maxComponents);
              if(external){await mutable(source);await mutable(destination);}
              if (!external && settings?.noReplace && pathProfile(destination, settings) !== 0) throw fsOperationError("ENOTSUP","rename",source,destination);
              return fs.rename(source, destination, settings);
            },
            async symlink(target, path, settings) {
              admitPath(path, settings);
              if(external)await mutable(path);
              return fs.symlink(target, path, settings);
            },
            openReadFile(path, settings) { return openHandle("openReadFile", path, settings); },
            open(path, settings) { return openHandle("open", path, settings); },
            async access(path, mode, settings) {
              admitPath(path, settings);
              return route("access",path,[mode,settings]);
            },
            async chmod(path, mode, settings) {
              admitPath(path, settings);
              return route("chmod",path,[mode,settings]);
            },
            async mkdir(path, settings) {
              admitPath(path, settings);
              const options = {...settings};
              if (options.mode === undefined) options.mode = directoryMode;
              check();
              return route("mkdir",path,[options]);
            },
            async createStagedFile(directory, name, content, settings) {
              admitPath(directory, settings);
              validatePath(directory + "/" + name, maxComponents);
              const controls = stageControls(settings);
              if(external)await mutable(directory);
              const receipt = await fs.createStagedFile(directory, name, content, controls);
              (stages ??= new Set()).add(receipt);
              if (!receipt.cleanup) return receipt;
              let removal;
              const cleanup = Object.freeze({
                remove: settings => removal ??= (async () => {
                  try {
                    settings?.signal?.throwIfAborted();
                    if (!stages.has(receipt)) throw fsOperationError("EBADF","removeStagedFile",directory);
                    chargeFs();
                    await receipt.cleanup.remove(settings);
                  } finally {
                    stages.delete(receipt);
                    await receipt.cleanup.close();
                  }
                })(),
                close: async () => { stages.delete(receipt); await receipt.cleanup.close(); },
              });
              const writer = receipt.writer && Object.freeze({
                write: async (data,settings) => {
                  if (busy) await busy;
                  admitPath(receipt.file.path,settings);
                  await receipt.writer.write(data,stageControls(settings));
                },
                finish: async settings => {
                  if (busy) await busy;
                  admitPath(receipt.file.path,settings);
                  return receipt.writer.finish(stageControls(settings));
                },
              });
              return Object.freeze({...receipt,cleanup,...(writer && {writer})});
            },
            async publishStagedFile(receipt, path, settings) {
              admitPath(path, settings);
              const controls = stageControls(settings);
              if (controls.ancestors !== undefined) controls.ancestors = Array.from(controls.ancestors,stageEntry);
              const snapshot=stageReceipt(receipt);
              if(external){
                for(const entry of [snapshot.directory.path,snapshot.file.path,path])await mutable(entry);
                if(controls.ancestors?.some(e=>e.path==="/dev" || e.path.startsWith("/dev/")) && await deviceKind("/dev",false))throw fsOperationError("ENOTSUP",undefined,path);
              }
              return fs.publishStagedFile(snapshot, path, controls);
            },
            async removeStagedFile(receipt, settings) {
              check();
              const snapshot = stageReceipt(receipt), controls = stageControls(settings);
              admitPath(snapshot.directory.path,controls);
              if(external){await mutable(snapshot.directory.path);await mutable(snapshot.file.path);}
              await fs.removeStagedFile(snapshot, controls);
              stages?.delete(receipt);
            },
            async writeFileConditional(path, data, settings) {
              admitPath(path,settings);
              return route("writeFileConditional",path,[data,settings],false);
            },
            writeFile(path, data, settings) { return write("writeFile", path, data, settings); },
            appendFile(path, data, settings) { return write("appendFile", path, data, settings); },
          };
          for (const operation of ["readFile", "stat", "lstat", "readdir", "rm", "unlink", "readlink", "realpath", "removeFileConditional", "prepareDirectory"]) {
            commandFs[operation] = async (path, settings) => {
              admitPath(path, settings);
              return route(operation,path,[settings],!["lstat","rm","unlink","readlink","removeFileConditional","prepareDirectory"].includes(operation));
            };
          }
          for (const [key,method] of Object.entries(commandFs)) {
            if (typeof method === "function") commandFs[key] = async (...args) => { if (busy) await busy; return method(...args); };
          }
          commandFs.readStream = (path, settings) => {
            const admission = busy?.then(() => admitPath(path,settings));
            if (admission) admission.catch(()=>{}); else admitPath(path,settings);
            const options = {...settings,signal:settings?.signal && settings.signal !== signal ? AbortSignal.any([signal,settings.signal]) : signal};
            const iterator = external ? (async function*(){yield* await route("readStream",path,[options]);})() : fs.readStream(path,options)[Symbol.asyncIterator]();
            const close = () => iterator.return().finally(()=>handles.delete(close));
            (handles ??= new Set()).add(close);
            return {
              [Symbol.asyncIterator]() { return this; },
              async next() {
                if (admission) await admission;
                if (busy) await busy;
                try {
                  check(); options.signal.throwIfAborted();
                  const chunk = await iterator.next();
                  check();
                  if (chunk.done) handles.delete(close);
                  return chunk;
                } catch (error) { await close(); throw error; }
              },
              return:close,
            };
          };
          const stdin = {async *[Symbol.asyncIterator]() {
            check();
            if (!(access & 1)) throw badDescriptor();
            if (busy) await busy;
            if (!definition) {
              for (;;) {
                const call = tail.then(()=>exchange([Uint8Array.of(132,0,0,0)],signal));
                tail = call.catch(()=>{});
                const {bytes} = await call;
                if (!bytes.length) return;
                yield bytes;
              }
            }
            const start = offset+consumed;
            if (start < packet.length) { consumed = packet.length-offset; yield packet.subarray(start); }
          }};
          const append = (index,bytes,paid) => {
            check(outputOpen);
            if (!(access & (2 << index))) throw badDescriptor();
            if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
            const length = bytes.byteLength;
            if (code === -5) throw new ShellLimitError("maxFileSystemOperations");
            if (code === -3 || !paid && length > remaining) { code = -3; throw new ShellLimitError("maxOutputBytes"); }
            const channel = sharedOutput ? 0 : index;
            if (paid) credits[channel] += length;
            else { remaining -= length; unpaid[channel] += length; }
            if (length) streams[channel].push(new Uint8Array(bytes));
          };
          const exchange = async (parts,childSignal) => {
            check();
            const done = Promise.withResolvers();
            busy = done.promise;
            job.resume = (status,bytes,output,ops) => {
              busy = undefined; remaining = output; remainingFsOps = ops;
              if (status < 0 && decoder.decode(bytes).startsWith("Execution aborted:")) stopped = new Error(decoder.decode(bytes));
              done.resolve({status,bytes});
            };
            job.childSignal = childSignal; job.request = parts; job.fsOps = fsOps; fsOps = 0;
            job.reserve = unpaid.slice(); job.fileOutput = fileOutput;
            for (let i=0;i<2;i++) { credits[i] += unpaid[i]; unpaid[i]=0; }
            job.next.resolve();
            const {status,bytes} = await done.promise;
            childSignal.throwIfAborted();
            if (status < 0) throw stopped ?? new Error(decoder.decode(bytes));
            check(); return {status,bytes};
          };
          const writeSink = async (i,bytes,paid) => {
            if (busy) await busy;
            if (!(access & (8 << i))) { append(i,bytes,paid); return; }
            check();
            if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
            const tag = new Uint8Array([128+i+(paid?2:0),0,0,0]);
            const data = bytes.slice();
            const call = tail.then(()=>exchange([tag,data],signal));
            tail = call.catch(()=>{});
            await call;
          };
          const sinks = [0,1].map(i=>({write:bytes=>writeSink(i,bytes,false)}));
          const invoke = async (name,args,settings={},proceed) => {
            check();
            settings.signal?.throwIfAborted();
            if (typeof name !== "string" || name.includes("\0") || !Array.isArray(args) || (proceed === undefined && args.some(a=>typeof a !== "string" || a.includes("\0"))))
              throw new TypeError("invoke requires a command and literal string arguments without NUL");
            if (settings.argv0 !== undefined && (typeof settings.argv0 !== "string" || settings.argv0.includes("\0"))) throw new TypeError("invoke argv0 must be a string without NUL");
            if (settings.admittedHandles || settings.processSignals) throw new Error("Unsupported child process capabilities");
            const carrier = commandContract.getCommandArguments({args,argumentValues:settings.argumentValues});
            const childCwd = proceed === undefined ? posix.resolve("/",context.cwd,settings.cwd ?? ".") : settings.cwd;
            const entries = Object.entries(proceed !== undefined || settings.replaceEnv ? settings.env ?? {}
              : {...context.env,...settings.env,PWD:childCwd});
            if (entries.some(([k,v])=>k.includes("\0") || k.includes("=") || typeof v !== "string" || v.includes("\0"))) throw new TypeError(proceed === undefined ? "Invalid invoke environment entry" : "Invalid middleware environment value");
            const inherited = settings.stdin === undefined || settings.stdin === stdin;
            children ??= new AbortController();
            const childSignal = AbortSignal.any([signal,children.signal,...(settings.signal ? [settings.signal] : [])]);
            let supplied;
            try { if (!inherited) supplied = await collectAsyncStdin(settings.stdin,childSignal,maxInput); }
            catch (error) {
              if (error instanceof ShellLimitError && error.limit === "maxInputBytes") { code = -9; stopped = error; }
              throw error;
            }
            const stdout = settings.stdout ?? sinks[0], stderr = settings.stderr ?? sinks[1];
            const call = tail.then(async () => {
              check(); childSignal.throwIfAborted();
              const input = inherited ? packet.subarray(offset+consumed) : supplied;
              const size = input.length;
              const parts = [], word = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0,n,true); parts.push(b); };
              const field = v => { const b = typeof v === "string" ? encoder.encode(v) : v; word(b.length); parts.push(b); };
              if (proceed !== undefined) {
                word(64); field(proceed);
                word(settings.cwd !== cwd ? 1 : 0);
                if (settings.cwd !== cwd) field(settings.cwd);
                const changes = entries.filter(([key,value])=>!Object.hasOwn(initialEnv,key) || initialEnv[key]!==value);
                const removed = Object.keys(initialEnv).filter(key=>!Object.hasOwn(settings.env,key));
                word(changes.length); word(removed.length);
                for (const [key,value] of changes) { field(key); field(value); }
                for (const key of removed) field(key);
                if (name !== command || carrier !== argumentValues) {
                  field(name);
                  for (let i=0;i<args.length;i++) field(carrier.bytes(i));
                }
              }
              else {
                word(1 | 4 | (!definition && inherited?256:0) | (settings.argv0!==undefined?2:0) | (settings.externalInvocation?8:0)
                  | ((settings.stdin===undefined?stdinIsDefault:settings.stdinIsDefault)?16:0)
                  | (stdout===stderr || sharedOutput && sinks.includes(stdout) && sinks.includes(stderr) ? 32:0));
                word(args.length); word(entries.length); field(name);
                field(childCwd);
                if (settings.argv0 !== undefined) field(settings.argv0);
                for (let i=0;i<args.length;i++) field(carrier.bytes(i));
                for (const [k,v] of entries) { field(k); field(v); }
                field(input);
              }
              const {status,bytes} = await exchange(parts,childSignal);
              if (status === 256) return {bytes,status};
              const view = new DataView(bytes.buffer);
              const left = view.getUint32(0,true);
              if (definition && inherited) consumed += size-left;
              return {bytes,status};
            });
            tail = call.catch(()=>{});
            const {bytes,status} = await call;
            if (status === 256) return;
            const view = new DataView(bytes.buffer);
            let pos = 4;
            for (const sink of [stdout,stderr]) {
              const n = view.getUint32(pos,true); pos += 4;
              const data = bytes.subarray(pos,pos+n); pos += n;
              if (!n) continue;
              const dest = sinks.indexOf(sink);
              if (dest < 0) await untilAbort(Promise.resolve(sink.write(data)),childSignal);
              else await writeSink(dest,data,true);
            }
            if (status >= 257 && status <= 260) {
              const kind = ["exit","return","break","continue"][status-257], previous=view.getInt32(pos+8,true);
              nativeFlow = {name:"Flow",message:kind,kind,status:view.getInt32(pos,true),levels:view.getUint32(pos+4,true),
                previousStatus:previous<0?undefined:previous,expansionFailure:false};
              throw nativeFlow;
            }
            return {exitCode:status};
          };
          check();
          const registerCleanup = cleanup => {
            check();
            if (typeof cleanup !== "function") throw new TypeError("Cleanup must be callable");
            (cleanups ??= []).push(cleanup);
          };
          const reserveFileOutput = bytes => {
            check();
            if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
            const length = bytes.byteLength;
            if (code === -3 || length > remaining) { code = -3; throw new ShellLimitError("maxOutputBytes"); }
            remaining -= length;
            fileOutput += length;
            return length;
          };
          bindFileOutputBudget({registerCleanup}, sink => ({async write(bytes) {
            if (busy) await busy;
            reserveFileOutput(bytes);
            await sink.write(bytes);
          }}), async (bytes,write,preserveReceipt) => {
            if (busy) await busy;
            const reserved = reserveFileOutput(bytes);
            const count = await write();
            if (busy) await busy;
            if (!Number.isSafeInteger(count) || count < 0 || count > reserved) throw fsOperationError("EIO","write");
            fileOutput -= reserved-count;
            remaining += reserved-count;
            if (!preserveReceipt) signal.throwIfAborted();
            return count;
          });
          const context = {onInternalError, registerCleanup, command, argv0, args:argumentValues.args, argumentValues,
            cwd, env, stdin, stdinIsDefault, invoke:(name,args,settings)=>invoke(name,args,settings), fs:commandFs, stdout:sinks[0], stderr:sinks[1], signal, capabilities:options.capabilities};
          const pending = definition ? definition.execute(context)
            : composeMiddleware(middleware,async forwarded=>{
              const {command:name,args,argumentValues:values,argv0} = forwarded;
              const handler = terminals.get(posix.basename(name));
              const result = await invoke(name,args,{argumentValues:values,cwd:forwarded.cwd,env:forwarded.env},handler?.name ?? "");
              if (result !== undefined) return result;
              return handler.execute(handler.name===name ? forwarded : {...forwarded,command:handler.name,argv0:argv0 ?? name});
            })(context);
          const result = await (options.signal || childSignals.length ? untilAbort(pending, signal) : pending);
          if (code >= 0) {
            code = commandContract.validateExitCode(result.exitCode);
          }
        } catch (error) {
          if (signal.aborted) code = -2;
          else if (nativeFlow && error === nativeFlow) code = -8;
          else if (code >= 0) {
            const message = diagnostics.publicDiagnosticMessage(error, onInternalError);
            if (message === "internal error") code = -4;
            else { code = -6; streams.push([encoder.encode(message)]); }
          }
        } finally {
          active = false;
          children?.abort(new Error("Command has finished"));
          await tail;
          if (handles) for (const close of handles) (cleanups ??= []).push(close);
          if (cleanups) {
            await Promise.all(cleanups.map(async cleanup => {
              try { await cleanup(); } catch (error) { cleanupFailures.push(error); }
            }));
            // Stop the evaluator after routing accepted writes. The caller receives the original cleanup error.
            if (cleanupFailures.length && (code >= 0 || code === -4 || code === -6)) code = -2;
            else if (code === -3 || code === -5) cleanupFailures.length = 0;
          }
          if (stages) for (const stage of Array.from(stages).reverse()) {
            try {
              if (signal.aborted || code < 0) {
                if (stage.cleanup) await stage.cleanup.remove();
                else await fs.removeStagedFile(stage);
              } else await stage.cleanup?.close();
            }
            catch (e) { if (!["EAGAIN","ENOTEMPTY","ENOENT"].includes(e.code)) cleanupFailures.push(e); }
          }
          outputOpen = false;
        }
        job.finish = {streams,credits,consumed,fsOps,code};
        job.fileOutput = fileOutput;
        job.next.resolve();
        };
        void run().catch(error => job.next.reject(error));
        return job.next.promise;
      }, (ptr, _len, reply) => {
        const job = jobs.get(ptr);
        new Uint8Array(x.memory.buffer,job.sp,job.stack.length).set(job.stack);
        x.__stack_pointer.value = job.sp;
        job.stack = undefined;
        new DataView(x.memory.buffer).setUint32(reply+88,job.fileOutput,true);
        if (job.request) {
          const parts = job.request, len = parts.reduce((n,b)=>n+b.length,0);
          const p = x.safe_bash_alloc(len), dest = new Uint8Array(x.memory.buffer,p,len);
          let pos=0; for (const b of parts) { dest.set(b,pos); pos+=b.length; }
          const view = new DataView(x.memory.buffer);
          view.setUint32(reply+44,p,true); view.setUint32(reply+48,len,true); view.setUint32(reply+36,job.fsOps,true);
          for (let i=0;i<2;i++) view.setUint32(reply+76+i*4,job.reserve[i],true);
          job.request = undefined;
          childSignals.push(job.childSignal);
          return -7;
        }
        jobs.delete(ptr);
        const {streams,credits,consumed,fsOps,code} = job.finish;
        for (const [i,chunks] of streams.entries()) {
          const len = chunks.reduce((n,chunk) => n + chunk.length, 0);
          if (!len) continue;
          const p = x.safe_bash_alloc(len);
          const dest = new Uint8Array(x.memory.buffer,p,len);
          let offset = 0;
          for (const chunk of chunks) { dest.set(chunk,offset); offset += chunk.length; }
          const v = new DataView(x.memory.buffer);
          const entry = reply + (i === 2 ? 44 : i * 8);
          v.setUint32(entry,p,true); v.setUint32(entry + 4,len,true);
        }
        const view = new DataView(x.memory.buffer);
        view.setUint32(reply + 16,consumed,true);
        view.setUint32(reply + 36,fsOps,true);
        for (let i=0;i<2;i++) view.setUint32(reply+76+i*4,credits[i],true);
        return (childSignals.at(-1) ?? executionSignal).aborted ? -2 : code;
      }));
      if (!definition) {
        if (x.safe_bash_register_middleware(shell.sessionId,slot) !== 0) throw new Error("Could not register middleware");
        continue;
      }
      const name = shell._allocBytes(encoder.encode(definition.name));
      try {
        if (x.safe_bash_register_command(shell.sessionId,name.ptr,name.len,slot) !== 0) throw new Error("Could not register command: " + definition.name);
      } finally { shell._freeBytes(name); }
    }
    return release;
  } catch (error) { release(); throw error; }
}

async function untilAbort(pending, signal) {
  let onAbort;
  const aborted = new Promise((_,reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort",onAbort,{once:true});
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([pending,aborted]); }
  finally { signal.removeEventListener("abort",onAbort); }
}

async function execAsyncStdin(shell, script, source, signal) {
  // Start on an idle linear stack, including for calls from a reentrant host callback.
  await Promise.resolve();
  signal?.throwIfAborted();
  const x = shell.exports, id = shell.sessionId, host = streamHost(x);
  const iterator = source[Symbol.asyncIterator]();
  const job = {shell,iterator,signal,top:x.__stack_pointer.value};
  const code = shell._allocBytes(encoder.encode(script));
  host.jobs.set(id,job);
  try {
    await host.exec(id,code.ptr,code.len,host.slot);
    signal?.throwIfAborted();
    return shell._execResult();
  } finally {
    host.jobs.delete(id);
    shell._freeBytes(code);
    if (job.data) shell._freeBytes(job.data);
    if (!job.done && iterator.return) {
      const closed = Promise.resolve().then(()=>iterator.return());
      if (signal?.aborted) closed.catch(()=>{});
      else {
        await (signal ? untilAbort(closed,signal) : closed).catch(error => {
          if (signal?.aborted || job.status !== -1) throw error;
        });
      }
    }
  }
}

async function collectAsyncStdin(source, signal, maximum) {
  const iterator = source[Symbol.asyncIterator]?.() ?? source[Symbol.iterator]();
  let bytes = new Uint8Array(0), length = 0;
  async function read() {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await iterator.next();
      signal?.throwIfAborted();
      if (done) return bytes.subarray(0, length);
      if (maximum !== undefined && !(value instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
      const data = value instanceof Uint8Array ? value : encoder.encode(String(value));
      const end = length + data.byteLength;
      if (maximum !== undefined && end > maximum) throw new ShellLimitError("maxInputBytes");
      if (end > bytes.length) {
        const grown = new Uint8Array(Math.min(maximum ?? Infinity, Math.max(end, bytes.length * 2)));
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      // The producer may reuse its buffer as soon as next() is called.
      bytes.set(data, length);
      length = end;
    }
  }
  try {
    return signal ? await untilAbort(read(), signal) : await read();
  } catch (error) {
    bytes = new Uint8Array(0);
    const closed = Promise.resolve().then(() => iterator.return?.()).catch(() => {});
    if (!signal?.aborted) await closed;
    throw error;
  }
}

function wasmDescriptor(bash, path, fd, kind, access, append) {
  const device = kind !== 0, mounted = kind === 2;
  const capabilities = Object.freeze({
    ...(!mounted && { noFollow:true }), position:true, positionedRead:access !== "write",
    positionedWrite:access !== "read" && (!append || device), truncate:kind !== 1 && access !== "read",
    synchronization:kind === 1 ? "none" : "volatile",
    ...(device && { openTruncate:true, positionedAppendWrite:access !== "read", delegateZeroLengthWrite:access !== "read" }),
    ...(mounted && { readObservation:true }),
  });
  let pending = Promise.resolve(), closing;
  function run(syscall, options, action) {
    const signal = options?.signal;
    try {
      signal?.throwIfAborted();
      if (closing) throw fsOperationError("EBADF", kind === 4 ? undefined : syscall, path);
    } catch (error) { return Promise.reject(error); }
    const result = pending.then(() => { signal?.throwIfAborted(); return action(); });
    pending = result.then(() => {}, () => {});
    return result;
  }
  function call(syscall, op, position = 0, ptr = 0, length = 0) {
    const rc = bash.exports.safe_bash_descriptor(bash.sessionId, fd, op, position, ptr, length);
    if (rc < 0) {
      const code = rc === -1 ? "EBADF" : decoder.decode(new Uint8Array(bash.exports.memory.buffer, bash.exports.safe_bash_output_ptr(bash.sessionId), -rc));
      throw fsOperationError(code, syscall, path);
    }
    return rc;
  }
  function checkBuffer(buffer, position, syscall) {
    if (syscall === "read" ? access === "write" : access === "read") throw fsOperationError("EBADF", syscall, path);
    if (!(buffer instanceof Uint8Array) || position !== null && (!Number.isSafeInteger(position) || position < 0)) {
      throw fsOperationError("EINVAL", syscall, path);
    }
  }
  const stat = options => run("fstat", options, () => {
    const size = call("fstat", 3);
    return bash._decodeStat(bash.exports.safe_bash_output_ptr(bash.sessionId), size);
  });
  const close = () => closing ??= pending.then(() => { try { call("close", 7); } finally { bash = undefined; } });
  if (kind >= 3) return {
    stat, close,
    seekEnd: options => run("lseek", options, () => {
      const size = call("lseek", 3);
      const st = bash._decodeStat(bash.exports.safe_bash_output_ptr(bash.sessionId), size);
      return st.isDirectory ? (1n << 63n) - 1n : BigInt(st.size);
    }),
    read: (position, maximum, options) => run("read", options, async () => {
      if (kind === 5) { await new Promise(resolve => setImmediate(resolve)); options?.signal?.throwIfAborted(); }
      if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(maximum)
          || maximum < 0 || kind !== 4 && (maximum === 0 || maximum > Number.MAX_SAFE_INTEGER - position)) throw fsOperationError("EINVAL", kind === 4 ? undefined : "read", path);
      // The Wasm ABI uses a u32 length. Rust clips it to the retained bytes before allocating.
      const n = call("read", 0, position, 0, Math.min(maximum, kind === 5 ? 65536 : 0xffffffff));
      const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
      return new Uint8Array(bash.exports.memory.buffer.slice(ptr, ptr + n));
    }),
  };
  return {
    capabilities, stat, close,
    getPosition: options => run("getPosition", options, () => call("getPosition", 4)),
    probeRead: options => run("probeRead", options, () => { call("probeRead", 5); return "ready"; }),
    read: (buffer, position, options) => run("read", options, async () => {
      checkBuffer(buffer, position, "read");
      let offset = 0;
      while (offset < buffer.length) {
        const length = mounted ? Math.min(65536, buffer.length - offset) : buffer.length;
        const n = call("read", 0, position === null ? -1 : position + offset, 0, length);
        buffer.set(new Uint8Array(bash.exports.memory.buffer, bash.exports.safe_bash_output_ptr(bash.sessionId), n), offset);
        offset += n;
        if (n < length || offset === buffer.length) break;
        await new Promise(resolve => setImmediate(resolve));
        options?.signal?.throwIfAborted();
      }
      return offset;
    }),
    write: (buffer, position, options) => run("write", options, () => {
      checkBuffer(buffer, position, "write");
      const data = device ? {ptr:0, len:buffer.length} : bash._allocBytes(buffer);
      try { return call("write", 1, position ?? -1, data.ptr, data.len); }
      finally { if (!device) bash._freeBytes(data); }
    }),
    truncate: (length, options) => run("ftruncate", options, () => {
      if (access === "read") throw fsOperationError("EBADF", "ftruncate", path);
      if (!Number.isSafeInteger(length) || length < 0) throw fsOperationError("EINVAL", "ftruncate", path);
      call("ftruncate", 2, length);
    }),
    sync: (dataOnly, options) => run(dataOnly ? "fdatasync" : "fsync", options, () => {
      if (typeof dataOnly !== "boolean") throw fsOperationError("EINVAL", "fsync", path);
      call(dataOnly ? "fdatasync" : "fsync", 6);
    }),
  };
}

const wasmCapabilities = Object.freeze({
  write: true, append: true, exclusiveCreate: true, read: true, retainedRead: true, streamingRead: true, stat: true, readdir: true, realpath: true, access: true,
  conditionalChmod: true, atomicFileMutation:true, atomicDirectoryMetadata:true, atomicFileStaging:true, atomicStagingAncestry:true, retainedStagingWrite:true, retainedStagingCleanup:true, permissions: true, readlink: true, symlinks: true,
});

export class WasmFileSystem {
  constructor(bash) {
    this.bash = bash;
  }

  get capabilities() {
    const backing = this.bash._companion?.fs;
    if (!backing) {
      const memory = !!this.bash.exports.safe_bash_supports_file_mutation(this.bash.sessionId);
      return Object.freeze({...wasmCapabilities,atomicFileMutation:memory,atomicDirectoryMetadata:memory,atomicFileStaging:memory,atomicStagingAncestry:memory,retainedStagingWrite:memory,retainedStagingCleanup:memory,
        conditionalChmod:!!this.bash.exports.safe_bash_supports_conditional_chmod(this.bash.sessionId)});
    }
    return Object.freeze(Object.fromEntries(Object.keys(wasmCapabilities)
      .map(key => [key, backing.capabilities?.[key] === true])));
  }

  writeFileConditional(filePath, data, options) {
    return this.bash._mutateConditional("writeFileConditional",filePath,data,options);
  }

  removeFileConditional(filePath, options) {
    return this.bash._mutateConditional("removeFileConditional",filePath,undefined,options);
  }

  createStagedFile(...args) { return this.bash._ownedStage("createStagedFile", args); }
  publishStagedFile(...args) { return this.bash._ownedStage("publishStagedFile", args); }
  removeStagedFile(...args) { return this.bash._ownedStage("removeStagedFile", args); }

  prepareDirectory(filePath, options) {
    return this.bash._mutateConditional("prepareDirectory",filePath,undefined,options);
  }

  async access(filePath, mode = 0, options) {
    options?.signal?.throwIfAborted();
    const bash = this.bash;
    if (bash._companion) {
      await bash._ensureCompanionSynced();
      return bash._companion.fs.access(filePath, mode, options);
    }
    if (typeof filePath !== "string") throw new TypeError("Filesystem paths must be strings");
    const path = bash._allocBytes(encoder.encode(filePath));
    try {
      const result = bash.exports.safe_bash_access(bash.sessionId, path.ptr, path.len,
        Number.isInteger(mode) && mode >= 0 && mode <= 7 ? mode : 8);
      if (result === -1) throw new Error("Wasm session unavailable");
      if (result < 0) throw readOperationError(decoder.decode(new Uint8Array(bash.exports.memory.buffer, bash.exports.safe_bash_output_ptr(bash.sessionId), -result)));
    } finally { bash._freeBytes(path); }
  }

  async readFile(filePath, options) {
    if (this.bash._companion) {
      options?.signal?.throwIfAborted();
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.readFile(filePath, options);
    }
    return this.bash.readFile(filePath, options);
  }

  writeFile(filePath, data, options) {
    return this.#writeData("writeFile", filePath, data, options);
  }

  appendFile(filePath, data, options) {
    return this.#writeData("appendFile", filePath, data, options);
  }

  async #writeData(operation, filePath, data, options) {
    options?.signal?.throwIfAborted();
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    if (!(bytes instanceof Uint8Array)) throw new TypeError("Files require Uint8Array data");
    const bash = this.bash;
    if (bash._companion) {
      await bash._ensureCompanionSynced();
      return bash._companion.fs[operation](filePath, bytes, options);
    }
    const flag = operation === "appendFile" ? "a" : options?.flag ?? "w";
    const mode = options?.mode === undefined ? 0o666 : options.mode;
    const validMode = Number.isInteger(mode) && mode >= 0 && mode <= 0o7777;
    const flags = ["w", "wx", "a", "ax"].indexOf(flag);
    const path = bash._allocBytes(encoder.encode(filePath));
    try {
      const data = bash._allocBytes(validMode && flags >= 0 ? bytes : new Uint8Array());
      try {
        const rc = bash.exports.safe_bash_fs_write_file(bash.sessionId, path.ptr, path.len, data.ptr, data.len, validMode ? mode : 0x1000, flags, operation === "appendFile");
        if (rc === -1) throw new Error("Wasm session unavailable");
        if (rc < 0) {
          const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
          throw readOperationError(decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, -rc)));
        }
      } finally { bash._freeBytes(data); }
    } finally { bash._freeBytes(path); }
    if (bash.companionFactory && !bash.forceNative) {
      const copy = new Uint8Array(bytes);
      bash._history.push({ type: "fs", run: (fs) => fs[operation](filePath, copy, operation === "appendFile" ? { mode } : { flag, mode }) });
    }
  }

  async mkdir(dirPath, options) {
    options?.signal?.throwIfAborted();
    const bash = this.bash;
    if (bash._companion) {
      await bash._ensureCompanionSynced();
      return bash._companion.fs.mkdir(dirPath, options);
    }
    const recursive = !!options?.recursive, mode = options?.mode ?? 0o777;
    let failure;
    const operand = String(dirPath);
    const encoded = bash._allocBytes(encoder.encode(operand));
    try {
      const rc = bash.exports.safe_bash_fs_mkdir(bash.sessionId, encoded.ptr, encoded.len, recursive,
        Number.isInteger(mode) && mode >= 0 && mode <= 0o7777 ? mode : 0xffffffff, typeof dirPath === "string");
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
        const text = decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, -rc));
        const sep = text.indexOf(":"), end = text.indexOf(":", sep + 1);
        const code = text.slice(1, sep), syscall = text.slice(sep + 1, end), path = text.slice(end + 1);
        const detail = syscall === "resolve" ? "paths must be strings without NUL bytes"
          : code === "ENOTSUP" ? (syscall === "overlay" ? "recursive creation through symlinks cannot be verified before mutation" : "operation not supported") : undefined;
        failure = fsOperationError(code, syscall || undefined, syscall === "resolve" ? undefined : path === operand ? dirPath : path, undefined, detail);
        if (text[0] === "0") throw failure;
      }
    } finally { bash._freeBytes(encoded); }
    if (bash.companionFactory && !bash.forceNative) {
      const exactMode = options?.exactMode;
      bash._history.push({type:"fs", run: async (fs) => {
        try { await fs.mkdir(dirPath, {recursive, mode, exactMode}); }
        catch (error) { if (failure && error.code === failure.code) return; throw error; }
        if (failure) throw new Error("Companion mkdir unexpectedly succeeded");
      }});
    }
    if (failure) throw failure;
  }

  async readdir(dirPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.readdir(dirPath, options);
    }
    const limit = options?.maxEntries;
    return this.bash.readdir(dirPath, limit === undefined ? Number.MAX_SAFE_INTEGER : limit === Infinity || Number.isSafeInteger(limit) && limit >= 0 ? limit : -1);
  }

  async stat(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || this.bash.companionFactory && !this.bash.forceNative) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.stat(filePath, options);
    }
    return this.bash.stat(filePath, true);
  }

  async lstat(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || this.bash.companionFactory && !this.bash.forceNative) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.lstat
        ? this.bash._companion.fs.lstat(filePath, options)
        : this.bash._companion.fs.stat(filePath, options);
    }
    return this.bash.stat(filePath, false);
  }

  async symlink(target, linkPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.symlink) {
        return this.bash._companion.fs.symlink(target, linkPath, options);
      }
    }
    this.bash.symlink(target, linkPath);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.symlink ? fs.symlink(target, linkPath) : Promise.resolve()),
      });
    }
  }

  async readlink(linkPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.readlink) {
        return this.bash._companion.fs.readlink(linkPath, options);
      }
    }
    return this.bash.readlink(linkPath);
  }

  async chmod(filePath, mode, options) {
    options?.signal?.throwIfAborted();
    const bash = this.bash;
    const { parent, expected, ancestors, commitGuard, signal } = options ?? {};
    const guarded = parent !== undefined || expected !== undefined || ancestors !== undefined || commitGuard !== undefined;
    if (bash._companion || guarded && bash.companionFactory && !bash.forceNative) {
      await bash._ensureCompanionSynced();
      options?.signal?.throwIfAborted();
      if (!bash._companion.fs.chmod) throw fsOperationError("ENOTSUP", "chmod", filePath);
      return bash._companion.fs.chmod(filePath, mode, options);
    }
    if (guarded) {
      if (parent === undefined || expected === undefined || ancestors === undefined) {
        throw fsOperationError("EINVAL", "chmod", filePath, undefined, "complete conditional chmod receipt is required");
      }
      bash.chmodConditional(filePath, mode, parent, expected, ancestors, commitGuard, signal);
    } else {
      bash.chmod(filePath, mode);
    }
    if (bash.companionFactory && !bash.forceNative) {
      bash._history.push({ type: "fs", run: fs => fs.chmod(filePath, mode) });
    }
  }

  async unlink(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.unlink) {
        return this.bash._companion.fs.unlink(filePath, options);
      }
      return this.bash._companion.fs.rm(filePath);
    }
    this.bash.removePath(filePath, 1);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.unlink ? fs.unlink(filePath) : fs.rm(filePath)),
      });
    }
  }

  async rm(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.rm(filePath, options);
    }
    const recursive = options?.recursive === true, force = options?.force === true;
    this.bash.removePath(filePath, recursive ? 0 : 3, force);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => fs.rm(filePath, {recursive, force}),
      });
    }
  }

  async rmdir(dirPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.rmdir) {
        return this.bash._companion.fs.rmdir(dirPath, options);
      }
      return this.bash._companion.fs.rm(dirPath);
    }
    this.bash.removePath(dirPath, 2);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.rmdir ? fs.rmdir(dirPath) : fs.rm(dirPath)),
      });
    }
  }

  async utimes(filePath, atime, mtime, options) {
    options?.signal?.throwIfAborted();
    if (atime instanceof Date) atime = atime.getTime();
    if (mtime instanceof Date) mtime = mtime.getTime();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.utimes) {
        return this.bash._companion.fs.utimes(filePath, atime, mtime, options);
      }
    }
    this.bash._setTimes(filePath, atime, mtime, true);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.utimes ? fs.utimes(filePath, atime, mtime) : Promise.resolve()),
      });
    }
  }

  async realpath(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.realpath) {
        return this.bash._companion.fs.realpath(filePath, options);
      }
    }
    const bash = this.bash;
    const p = bash._allocBytes(encoder.encode(filePath));
    try {
      const len = bash.exports.safe_bash_realpath(bash.sessionId, p.ptr, p.len);
      if (len === -1) throw new Error("Wasm session unavailable");
      const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
      const text = decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, Math.abs(len)));
      if (len < 0) throw readOperationError(text);
      return text;
    } finally {
      bash._freeBytes(p);
    }
  }

  async openReadFile(filePath, options = {}) {
    return this.#openReader(filePath,options,options.allowDirectory === true ? 1 : 0);
  }

  async *readStream(filePath, options = {}) {
    options.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      const fs = this.bash._companion.fs;
      if (!fs.readStream) throw fsOperationError("ENOTSUP","readStream",filePath);
      yield* fs.readStream(filePath,options);
      return;
    }
    let position = options.start ?? 0;
    const end = options.endExclusive ?? Number.MAX_SAFE_INTEGER, size = options.chunkSize ?? 65536;
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(end) || end < position || !Number.isSafeInteger(size) || size <= 0) {
      throw fsOperationError("EINVAL","readStream",filePath);
    }
    const handle = await this.#openReader(filePath,options,2);
    try {
      while (position < end) {
        const chunk = await handle.read(position,Math.min(size,end-position),options);
        options.signal?.throwIfAborted();
        if (!chunk.length) break;
        position += chunk.length;
        yield chunk;
        options.signal?.throwIfAborted();
      }
    } finally { await handle.close(); }
  }

  async #openReader(filePath, options, mode) {
    const {signal} = options;
    signal?.throwIfAborted();
    const bash = this.bash;
    if (bash._companion) {
      await bash._ensureCompanionSynced();
      if (!bash._companion.fs.openReadFile) throw fsOperationError("ENOTSUP", "openReadFile", filePath);
      return bash._companion.fs.openReadFile(filePath, options);
    }
    if (typeof filePath !== "string") throw new TypeError("Filesystem paths must be strings");
    const path = bash._allocBytes(encoder.encode(filePath));
    try {
      const fd = bash.exports.safe_bash_open_read_file(bash.sessionId, path.ptr, path.len, mode);
      if (fd === -1) throw new Error("Wasm session unavailable");
      if (fd < 0) throw readOperationError(decoder.decode(new Uint8Array(bash.exports.memory.buffer, bash.exports.safe_bash_output_ptr(bash.sessionId), -fd)));
      const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
      const info = new Uint8Array(bash.exports.memory.buffer, ptr, bash.exports.safe_bash_output_len(bash.sessionId));
      const handle = wasmDescriptor(bash, decoder.decode(info.subarray(1)), fd, info[0], "read", false);
      if (signal) {
        await Promise.resolve();
        if (signal.aborted) { await handle.close(); signal.throwIfAborted(); }
      }
      return handle;
    } finally { bash._freeBytes(path); }
  }

  async open(filePath, options) {
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.open) {
        return this.bash._companion.fs.open(filePath, options);
      }
    }
    const signal = options?.signal;
    signal?.throwIfAborted();
    const {access, creation = "never", truncate = false, append = false, mode = 0o666, noFollow = false, exactMode = false, synchronization} = options ?? {};
    const invalid = !["read", "write", "readwrite"].includes(access) || !["never", "ifMissing", "exclusive"].includes(creation)
      || ![truncate, append, noFollow, exactMode].every(v => typeof v === "boolean")
      || access === "read" && (truncate || append) || !Number.isInteger(mode) || mode < 0 || mode > 0o7777
      || synchronization !== undefined && !["data", "all"].includes(synchronization)
      || Object.keys(options).some(k => !["access","creation","truncate","append","mode","exactMode","noFollow","synchronization","signal"].includes(k));
    const flags = (access !== "write" ? 1 : 0) | (access !== "read" ? 2 : 0) | (creation === "ifMissing" ? 4 : 0)
      | (creation === "exclusive" ? 8 : 0) | (truncate ? 16 : 0) | (append ? 32 : 0) | (noFollow ? 64 : 0) | (synchronization ? 128 : 0);
    const bash = this.bash;
    const path = bash._allocBytes(encoder.encode(filePath));
    try {
      const fd = bash.exports.safe_bash_open(bash.sessionId, path.ptr, path.len, invalid ? 256 : flags, invalid ? 0 : mode);
      const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
      if (fd === -1) throw new Error("Wasm session unavailable");
      if (fd < 0) {
        const error = decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, -fd));
        throw fsOperationError(error, "open", error.slice(error.indexOf(":") + 1));
      }
      const [kind, prependRoot] = new Uint8Array(bash.exports.memory.buffer, ptr, 2);
      const descriptor = wasmDescriptor(bash, prependRoot ? "/" + filePath : filePath, fd, kind, access, append);
      if (signal) {
        await Promise.resolve();
        if (signal.aborted) { await descriptor.close(); signal.throwIfAborted(); }
      }
      return descriptor;
    } finally { bash._freeBytes(path); }
  }

  async link(oldPath, newPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      options?.signal?.throwIfAborted();
      const fs = this.bash._companion.fs;
      if (!fs.link) throw fsOperationError("ENOTSUP", "link", oldPath, newPath);
      return fs.link(oldPath, newPath, options);
    }
    this.#twoPathOperation("safe_bash_link", "link", oldPath, newPath);
  }

  async rename(oldPath, newPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.rename) {
        return this.bash._companion.fs.rename(oldPath, newPath, options);
      }
    }
    this.#twoPathOperation("safe_bash_rename", "rename", oldPath, newPath, options?.noReplace === true);
  }

  #twoPathOperation(wasmExport, syscall, oldPath, newPath, flag) {
    const bash = this.bash;
    const src = bash._allocBytes(encoder.encode(oldPath));
    try {
      const dst = bash._allocBytes(encoder.encode(newPath));
      try {
        const rc = bash.exports[wasmExport](bash.sessionId, src.ptr, src.len, dst.ptr, dst.len, flag);
        if (rc === -1) throw new Error("Wasm session unavailable");
        if (rc < 0) {
          const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
          const message = decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, -rc));
          if (syscall === "rename") {
            const error = readOperationError(message);
            if (error.syscall !== "rename") throw error;
          }
          if (syscall === "link") {
            const [code, scope] = message.split(":");
            if (scope === "overlay") throw fsOperationError(code, "overlay", newPath, undefined, "overlay hardlinks are not supported");
            if (scope === "source" || scope === "destination") throw fsOperationError(code, code === "EBUSY" ? undefined : syscall, scope === "source" ? oldPath : newPath);
            if (scope === "mounted") {
              if (!oldPath.startsWith("/")) oldPath = "/" + oldPath;
              if (!newPath.startsWith("/")) newPath = "/" + newPath;
            }
          }
          throw fsOperationError(message, syscall, oldPath, newPath);
        }
      } finally {
        bash._freeBytes(dst);
      }
    } finally {
      bash._freeBytes(src);
    }
  }

  async copyFile(srcPath, destPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.copyFile) {
        return this.bash._companion.fs.copyFile(srcPath, destPath, options);
      }
    }
    this.#twoPathOperation("safe_bash_copy_file", "copyFile", srcPath, destPath, options?.exclusive === true);
  }

  async statfs(filePath, options) {
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.statfs) {
        return this.bash._companion.fs.statfs(filePath, options);
      }
    }
    return { type: 0, bsize: 4096, blocks: 65536, bfree: 32768, bavail: 32768, files: 100000, ffree: 90000 };
  }
}

const SAFE_DETERMINISTIC_CMDS = new Set([
  "true",
  "false",
  ":",
  "pwd",
  "cd",
  "export",
  "unset",
  "mkdir",
]);

function validateEnvEntry(key, value) {
  if (key.includes("\0") || key.includes("=") || typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Invalid environment entry");
  }
}

class WasmShell {
  constructor(exports, sessionId, cwd, env, limitError) {
    this.exports = exports;
    this.sessionId = sessionId;
    this.state = { cwd, env: { ...env }, vars: {}, functions: {} };
    this.ShellLimitError = limitError;
  }

  _allocBytes(bytes) {
    const len = bytes.byteLength;
    if (len === 0) {
      return { ptr: 0, len: 0 };
    }
    const ptr = this.exports.safe_bash_alloc(len);
    const mem = new Uint8Array(this.exports.memory.buffer, ptr, len);
    mem.set(bytes);
    return { ptr, len };
  }

  _freeBytes({ ptr, len }) {
    if (ptr !== 0 && len > 0) {
      this.exports.safe_bash_dealloc(ptr, len);
    }
  }

  setLimits(limits) {
    if (!limits || typeof limits !== "object" || !this.exports.safe_bash_set_limit) {
      return;
    }
    for (const [k, v] of Object.entries(limits)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        const kb = this._allocBytes(encoder.encode(k));
        try {
          this.exports.safe_bash_set_limit(this.sessionId, kb.ptr, kb.len, Math.trunc(v));
        } finally {
          this._freeBytes(kb);
        }
      }
    }
  }

  setEnv(key, value) {
    validateEnvEntry(key, value);
    this.state.env[key] = value;
    this._setBinding(key, value);
  }

  _setBinding(key, value) {
    if (key === "\0cwd") {
      this.state.cwd = value;
      this.state.env.PWD = value;
    }
    const k = this._allocBytes(encoder.encode(key));
    const v = this._allocBytes(encoder.encode(value));
    try {
      this.exports.safe_bash_set_env(this.sessionId, k.ptr, k.len, v.ptr, v.len);
    } finally {
      this._freeBytes(k);
      this._freeBytes(v);
    }
  }

  restoreSession(state) {
    if ("rawHistory" in state) throw new TypeError("Command history cannot restore a shell session");
    const data = this._allocBytes(encoder.encode(JSON.stringify(state)));
    try {
      const n = this.exports.safe_bash_restore_session(this.sessionId, data.ptr, data.len);
      if (n !== 0) {
        const message = decoder.decode(new Uint8Array(this.exports.memory.buffer, this.exports.safe_bash_output_ptr(this.sessionId), n));
        const prefix = "Shell limit exceeded: ";
        if (message.startsWith(prefix)) throw new this.ShellLimitError(message.slice(prefix.length));
        throw new TypeError(message);
      }
    } finally { this._freeBytes(data); }
  }

  snapshot(status) {
    const n = this.exports.safe_bash_session_snapshot(this.sessionId, status);
    return JSON.parse(decoder.decode(new Uint8Array(this.exports.memory.buffer, this.exports.safe_bash_output_ptr(this.sessionId), n)));
  }

  _execResult() {
    const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
    const outLen = this.exports.safe_bash_output_len(this.sessionId);
    if (outLen < 16) {
      const empty = new Uint8Array(0);
      return {
        stdout: "",
        stderr: "",
        stdoutBytes: empty,
        stderrBytes: empty,
        exitCode: 1,
        cwd: this.state.cwd,
        env: this.state.env,
      };
    }
    const view = new DataView(this.exports.memory.buffer, outPtr, outLen);
    const exitCode = view.getInt32(0, true);
    const stdoutLen = view.getUint32(4, true);
    const stderrLen = view.getUint32(8, true);
    const cwdLen = view.getUint32(12, true);
    let offset = outPtr + 16;
    const stdoutBytes = new Uint8Array(this.exports.memory.buffer.slice(offset, offset + stdoutLen));
    const stdout = decoder.decode(stdoutBytes);
    offset += stdoutLen;
    const stderrBytes = new Uint8Array(this.exports.memory.buffer.slice(offset, offset + stderrLen));
    const stderr = decoder.decode(stderrBytes);
    offset += stderrLen;
    const cwd = decoder.decode(new Uint8Array(this.exports.memory.buffer, offset, cwdLen));
    this.state.cwd = cwd;
    if (exitCode === -124) {
      const overlay = ", overlay '";
      const at = stderr.indexOf(overlay);
      if (at > 0 && stderr.endsWith("'") && stderr.startsWith("E")) {
        const colon = stderr.indexOf(": ");
        throw fsOperationError(stderr, "overlay", stderr.slice(at + overlay.length, -1), undefined, stderr.slice(colon + 2, at));
      }
      const m = /Shell limit exceeded: (\w+)/.exec(stderr);
      if (m) {
        throw new this.ShellLimitError(m[1]);
      }
      throw new Error(stderr.trim() || "Execution aborted");
    }
    return {
      stdout,
      stderr,
      stdoutBytes,
      stderrBytes,
      exitCode,
      cwd,
      env: this.state.env,
    };
  }

  execSync(script, stdin) {
    if (!this.sessionId) throw new Error("Shell session is disposed");
    const s = this._allocBytes(encoder.encode(script));
    let i;
    try {
      i = this._allocBytes(stdin === undefined || typeof stdin === "string" ? encoder.encode(stdin) : stdin);
      this.exports.safe_bash_exec(this.sessionId, s.ptr, s.len, i.ptr || (stdin === undefined ? 0 : s.ptr), i.len);
      return this._execResult();
    } catch (err) {
      if (i === undefined || err?.[FS_ERROR_BRAND] || err instanceof ShellLimitError || err instanceof this.ShellLimitError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const stderrBytes = encoder.encode(msg + "\n");
      return {
        stdout: "",
        stderr: msg + "\n",
        stdoutBytes: new Uint8Array(0),
        stderrBytes,
        exitCode: 1,
        cwd: this.state.cwd,
        env: this.state.env,
      };
    } finally {
      if (i !== undefined) this._freeBytes(i);
      this._freeBytes(s);
    }
  }

  dispose() {
    if (this.sessionId) {
      this.exports.safe_bash_destroy_session(this.sessionId);
      this.sessionId = 0;
    }
  }
}

export class RustWasmBash extends WasmShell {
  #sessions = new Set();
  #companion;
  #hostRoot;
  #filesystems = new Map();
  #ready;
  #commands;
  #commandContract;
  #bindFileOutputBudget;
  #diagnostics;
  #onInternalError;
  #validatePath;
  #plugins = [];
  #middleware = [];
  #composeMiddleware;
  #providedCapabilities;
  #pluginLifetime;
  #activePlugins = new Set();
  #disposal;

  #identityScopes = new Map();
  #scopeKeys = new WeakMap();
  #overlayReceipts = new WeakMap();
  #overlay = false;
  #releasedScopes = typeof FinalizationRegistry === "function" && typeof WeakRef === "function" && new FinalizationRegistry(scope => {
    if (!this.#identityScopes.get(scope)?.deref()) this.#identityScopes.delete(scope);
  });
  constructor(options = {}, instance) {
    if (options.onInternalError !== undefined && typeof options.onInternalError !== "function") throw new TypeError("onInternalError must be callable");
    if (options.deviceView !== undefined && !["provided", "default"].includes(options.deviceView)) {
      throw new TypeError("deviceView must be default or provided");
    }
    if (options.fs != null && [options.files, options.directories, options.symlinks, options.profile, options.memoryFsOptions].some(v => v !== undefined)) {
      throw new TypeError("Seed and configure a host filesystem before supplying it to the shell");
    }
    instance ??= createWasmInstance();
    super(instance.exports, instance.exports.safe_bash_create_session(), options.cwd ?? "/workspace", options.env, options.ShellLimitError ?? ShellLimitError);
    this.instance = instance;
    this.shell = this;
    this.#hostRoot = options.fs;
    this.fs = this.#hostRoot ?? new WasmFileSystem(this);
    this.forceNative = options.forceNative ?? true;
    this.companionFactory = options.companionFactory ?? null;
    this.companionSeed = options.companionSeed ?? null;
    this._companion = null;
    this._companionSyncPromise = null;
    this._history = [];
    this.hooks = options.hooks;
    this.#onInternalError = options.onInternalError;

    const providedDevices = options.deviceView === "provided" || options.profile === "strict-budgets-mount-dev";
    if (providedDevices) {
      this.exports.safe_bash_use_provided_devices(this.sessionId);
    }
    if (options.directories) {
      for (const dir of options.directories) {
        this.mkdirAll(dir);
      }
    }
    if (options.files) {
      for (const [filePath, init] of Object.entries(options.files)) {
        const bytes =
          typeof init === "string"
            ? encoder.encode(init)
            : init instanceof Uint8Array
              ? init
              : typeof init.content === "string"
                ? encoder.encode(init.content)
                : init.content;
        this.writeFile(filePath, bytes);
        this.chmod(filePath, init.mode ?? 0o666);
        if (init.mtime !== undefined) this.setMtime(filePath, init.mtime);
      }
    }
    if (options.symlinks) {
      for (const [linkPath, target] of Object.entries(options.symlinks)) {
        this.mkdirAll(posix.dirname(linkPath));
        this.symlink(target, linkPath);
      }
    }
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        this.setEnv(k, v);
      }
    }
    if (options.limits) {
      this.setLimits(options.limits);
    }
    if (options.memoryFsOptions) {
      const vfsLimits = {};
      if (typeof options.memoryFsOptions.maxBytes === "number" && Number.isFinite(options.memoryFsOptions.maxBytes)) {
        vfsLimits.maxBytes = options.memoryFsOptions.maxBytes;
      }
      if (typeof options.memoryFsOptions.maxFileBytes === "number" && Number.isFinite(options.memoryFsOptions.maxFileBytes)) {
        vfsLimits.maxFileBytes = options.memoryFsOptions.maxFileBytes;
      }
      if (typeof options.memoryFsOptions.maxFiles === "number" && Number.isFinite(options.memoryFsOptions.maxFiles)) {
        vfsLimits.maxFiles = options.memoryFsOptions.maxFiles;
      }
      if (typeof options.memoryFsOptions.maxMetadataUnits === "number" && Number.isFinite(options.memoryFsOptions.maxMetadataUnits)) {
        vfsLimits.maxFiles = options.memoryFsOptions.maxMetadataUnits;
      }
      if (Object.keys(vfsLimits).length > 0) {
        this.setLimits(vfsLimits);
      }
    }
    if (options.cwd && options.cwd !== "/workspace") {
      if (!this.#hostRoot) this.mkdirAll(options.cwd);
      this._setBinding("\0cwd", options.cwd);
    }
    if (options.profile === "overlay-cow-fs") {
      this.exports.safe_bash_configure_profile(this.sessionId, 1);
      this.#overlay = true;
    } else if (options.profile === "strict-budgets-mount-dev") {
      this.exports.safe_bash_configure_profile(this.sessionId, 2);
    }
  }

  #requireNativeFs() {
    if (this.#hostRoot) throw new TypeError("Use async exec() or fs methods with a host filesystem");
  }

  mountDevices() {
    this.#requireNativeFs();
    if (this.exports.safe_bash_configure_profile(this.sessionId, 3) !== 0) {
      throw new Error("Unable to mount virtual devices");
    }
    this.#overlay = false;
  }

  mkdirAll(dirPath) {
    this.#requireNativeFs();
    const p = this._allocBytes(encoder.encode(dirPath));
    try {
      this.exports.safe_bash_mkdir_all(this.sessionId, p.ptr, p.len);
    } finally {
      this._freeBytes(p);
    }
  }

  writeFile(filePath, data) {
    this.#requireNativeFs();
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const p = this._allocBytes(encoder.encode(filePath));
    const d = this._allocBytes(bytes);
    try {
      this.exports.safe_bash_write_file(this.sessionId, p.ptr, p.len, d.ptr, d.len);
    } finally {
      this._freeBytes(p);
      this._freeBytes(d);
    }
  }

  readFile(filePath, options) {
    this.#requireNativeFs();
    options?.signal?.throwIfAborted();
    const limit = options?.maxBytes;
    const maxBytes = limit === undefined ? NaN : limit === Infinity || Number.isSafeInteger(limit) ? limit : -1;
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const len = this.exports.safe_bash_read_file(this.sessionId, p.ptr, p.len, maxBytes);
      if (len === -1) throw new Error("Wasm session unavailable");
      if (len < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -len)));
      }
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      return new Uint8Array(this.exports.memory.buffer.slice(outPtr, outPtr + len));
    } finally {
      this._freeBytes(p);
    }
  }

  readText(filePath) {
    return decoder.decode(this.readFile(filePath));
  }

  removePath(filePath, operation = 0, force = false) {
    this.#requireNativeFs();
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const rc = this.exports.safe_bash_remove_path(this.sessionId, p.ptr, p.len, operation, force);
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        const message = decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -rc));
        throw readOperationError(message);
      }
    } finally {
      this._freeBytes(p);
    }
  }

  symlink(target, linkPath) {
    this.#requireNativeFs();
    const t = this._allocBytes(encoder.encode(target));
    const p = this._allocBytes(encoder.encode(linkPath));
    try {
      const rc = this.exports.safe_bash_symlink(this.sessionId, t.ptr, t.len, p.ptr, p.len);
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -rc)));
      }
    } finally {
      this._freeBytes(t);
      this._freeBytes(p);
    }
  }

  readlink(linkPath) {
    this.#requireNativeFs();
    const p = this._allocBytes(encoder.encode(linkPath));
    try {
      const len = this.exports.safe_bash_readlink(this.sessionId, p.ptr, p.len);
      if (len === -1) throw new Error("Wasm session unavailable");
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      if (len < 0) throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, -len)));
      return decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, len));
    } finally {
      this._freeBytes(p);
    }
  }

  chmod(filePath, mode) {
    this.#requireNativeFs();
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const rc = this.exports.safe_bash_chmod(this.sessionId, p.ptr, p.len, typeof mode === "number" ? mode : NaN, mode === undefined);
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -rc)));
      }
    } finally {
      this._freeBytes(p);
    }
  }

  #memoryReceipt(s) {
    const key = this.#scopeKeys.get(s?.identityScope);
    const complete = (typeof s?.identityScope === "symbol" || typeof s?.identityScope === "object" && s.identityScope !== null)
      && Number.isSafeInteger(s.dev) && s.dev >= 0 && Number.isSafeInteger(s.ino) && s.ino >= 0;
    // Only the issuing session can translate its opaque scope back to a native store.
    const scope = !complete ? NaN : key === undefined || key >= 0n ? -1 : Number(~key);
    return [scope, s?.dev === 0 ? s.ino : -1, ["file","directory","symlink","character"].indexOf(s?.type),
      ...[s?.revision,s?.size,s?.mode,s?.nlink,s?.mtimeMs,s?.ctimeMs].map(n => typeof n === "number" ? n : NaN)];
  }

  async _ownedStage(operation, args) {
    const create = operation === "createStagedFile", publish = operation === "publishStagedFile";
    const options = args[create ? 3 : publish ? 2 : 1] ?? {};
    const {signal} = options;
    signal?.throwIfAborted();
    if (this._companion || this.companionFactory && !this.forceNative) {
      await this._ensureCompanionSynced();
      signal?.throwIfAborted();
      const fs = this._companion.fs;
      if (!fs[operation]) throw fsOperationError("ENOTSUP",operation);
      return fs[operation](...args);
    }
    return this.#nativeStage(create ? 0 : publish ? 1 : 2, args, options);
  }

  #nativeStage(op, args, options) {
    const create = op === 0, publish = op === 1;
    const operation = ["createStagedFile","publishStagedFile","removeStagedFile","stagedWrite","stagedWrite","removeStagedFile"][op];
    const {signal,retainCleanup} = options;
    const paths = [], rows = [];
    let flags = 0, mode = 0, atime, mtime, payload = new Uint8Array();
    const entry = ({path,stat}) => { paths.push(path); rows.push(...this.#memoryReceipt(stat)); };
    if (create) {
      const [directory,name,content] = args;
      if (retainCleanup !== undefined && typeof retainCleanup !== "boolean") throw fsOperationError("EINVAL",operation,directory);
      paths.push(directory,name);
      rows.push(...this.#memoryReceipt(options.parent));
      const link = content.type === "symlink";
      if (link ? typeof content.target !== "string" : content.type !== "file" || !(content.data instanceof Uint8Array)) throw new TypeError("Invalid staged file content");
      payload = link ? encoder.encode(content.target) : content.data;
      mode = options.mode === undefined ? link ? 0o777 : 0o666 : options.mode;
      atime = options.atimeMs; mtime = options.mtimeMs;
      flags = Number(link) | (atime !== undefined ? 2 : 0) | (mtime !== undefined ? 4 : 0) | (retainCleanup ? 8 : 0);
    } else {
      const [receipt,destination] = args;
      for (const key of ["parent","directory","file"]) entry(receipt[key]);
      if (op === 3) {
        if (!(args[1] instanceof Uint8Array)) throw new TypeError("Staged writes require Uint8Array data");
        payload = args[1];
      } else if (op === 4) { atime = args[1].atimeMs; mtime = args[1].mtimeMs; }
      if (publish) {
        if (options.preserveIdentity || options.commitGuard !== undefined) throw fsOperationError("ENOTSUP",operation,destination);
        paths.push(destination); rows.push(...this.#memoryReceipt(options.parent));
        if (options.destination !== null) { flags |= 1; rows.push(...this.#memoryReceipt(options.destination)); }
        if (options.ancestors !== undefined) { flags |= 2; for (const ancestor of options.ancestors) entry(ancestor); }
      }
    }
    if (paths.some(p => typeof p !== "string" || p.includes("\0"))) throw fsOperationError("EINVAL",operation);
    signal?.throwIfAborted();
    const buffers = [];
    try {
      for (const data of [encoder.encode(paths.join("\0")),new Uint8Array(new Float64Array(rows).buffer),payload]) buffers.push(this._allocBytes(data));
      const n = this.exports.safe_bash_owned_stage(this.sessionId,...buffers.flatMap(b=>[b.ptr,b.len]),op,flags,
        typeof mode === "number" ? mode : NaN, typeof atime === "number" ? atime : NaN, typeof mtime === "number" ? mtime : NaN);
      if (n === -1) throw new Error("Wasm session unavailable");
      let ptr = this.exports.safe_bash_output_ptr(this.sessionId);
      const memory = this.exports.memory.buffer;
      if (n < 0) throw readOperationError(decoder.decode(new Uint8Array(memory,ptr,-n)));
      if (create) {
        const receipt = {}, view = new DataView(memory);
        for (const key of ["parent","directory","file"]) {
          const len = view.getUint32(ptr,true); ptr += 4;
          const path = decoder.decode(new Uint8Array(memory,ptr,len)); ptr += len;
          const size = view.getUint32(ptr,true); ptr += 4;
          receipt[key] = Object.freeze({path,stat:Object.freeze(this._decodeStat(ptr,size))}); ptr += size;
        }
        if (!retainCleanup) return Object.freeze(receipt);
        let current = receipt, writing = true, closed = false, removing;
        const release = () => {
          if (!current) return;
          current = undefined;
          if (receipt.file.stat.type === "file") this.exports.safe_bash_close_stage(this.sessionId,BigInt(receipt.file.stat.ino));
        };
        const cleanup = Object.freeze({
          remove: (settings={}) => {
            if (removing) return removing;
            if (closed) return Promise.reject(fsOperationError("EBADF","removeStagedFile",receipt.directory.path));
            closed = true;
            removing = Promise.resolve().then(()=>this.#nativeStage(5,[current],settings)).finally(release);
            return removing;
          },
          close: async () => { closed = true; if (removing) await removing.catch(()=>{}); else release(); },
        });
        const update = (op,data,settings) => {
          settings.signal?.throwIfAborted();
          if (closed || !writing) throw fsOperationError("EBADF","stagedWrite",receipt.file.path);
          const stat = this.#nativeStage(op,[current,data],settings);
          current = {...receipt,file:{path:receipt.file.path,stat}};
          return stat;
        };
        const writer = receipt.file.stat.type === "file" && Object.freeze({
          write: async (bytes,settings={}) => { update(3,bytes,settings); },
          finish: async (settings={}) => { const stat=update(4,receipt.file.stat,settings); writing=false; return stat; },
        });
        return Object.freeze({...receipt,cleanup,...(writer && {writer})});
      }
      if (n) return Object.freeze(this._decodeStat(ptr,n));
    } finally { for (const buffer of buffers) this._freeBytes(buffer); }
  }

  async _mutateConditional(name, filePath, data, options) {
    const {parent,expected,signal,mode,atimeMs,mtimeMs,append} = options;
    signal?.throwIfAborted();
    const writing = name === "writeFileConditional";
    if (this._companion || this.companionFactory && !this.forceNative) {
      await this._ensureCompanionSynced();
      signal?.throwIfAborted();
      const fs = this._companion.fs;
      if (!fs[name]) throw fsOperationError("ENOTSUP",name,filePath);
      return writing ? fs[name](filePath,data,options) : fs[name](filePath,options);
    }
    if (typeof filePath !== "string") throw new TypeError("Filesystem paths must be strings");
    if (writing && !(data instanceof Uint8Array)) throw new TypeError("Memory files require Uint8Array data");
    const rows = this.#memoryReceipt(parent);
    if (expected !== null) rows.push(...this.#memoryReceipt(expected));
    const flags = (name === "prepareDirectory" ? 16 | (mode !== undefined ? 32 : 0) : Number(writing)) | (append ? 2 : 0) | (atimeMs !== undefined ? 4 : 0) | (mtimeMs !== undefined ? 8 : 0);
    signal?.throwIfAborted();
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const receipt = this._allocBytes(new Uint8Array(new Float64Array(rows).buffer));
      try {
        const bytes = this._allocBytes(writing ? data : new Uint8Array());
        try {
          const n = this.exports.safe_bash_mutate_file_conditional(this.sessionId,p.ptr,p.len,receipt.ptr,receipt.len,bytes.ptr,bytes.len,flags,
            mode === undefined ? 0o666 : typeof mode === "number" ? mode : NaN, typeof atimeMs === "number" ? atimeMs : NaN, typeof mtimeMs === "number" ? mtimeMs : NaN);
          if (n === -1) throw new Error("Wasm session unavailable");
          const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
          if (n < 0) throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer,ptr,-n)));
          if (n) return Object.freeze(this._decodeStat(ptr,n));
        } finally { this._freeBytes(bytes); }
      } finally { this._freeBytes(receipt); }
    } finally { this._freeBytes(p); }
  }

  chmodConditional(filePath, mode, parent, expected, ancestors, guard, signal) {
    const fail = code => { throw fsOperationError(code, "chmod", filePath); };
    if (guard !== undefined && typeof guard !== "function") fail("EINVAL");
    let last = "";
    const entries = ancestors.map(({path: p, stat}, i) => {
      if (stat.type !== "directory" || (i === 0 ? p !== "/" : p === "/" || posix.dirname(p) !== last)) fail("EINVAL");
      last = p;
      return stat;
    });
    if (last !== posix.dirname(filePath)) fail("EINVAL");
    entries.push(parent, expected);
    if (this.#overlay && (!Number.isInteger(mode) || mode < 0 || mode > 0o7777)) throw fsOperationError("EINVAL","overlay",filePath);
    const packed = this.#overlay ? new Uint8Array(entries.length*48) : new Float64Array(entries.length * 9);
    let differentType = false;
    for (const [i,s] of entries.entries()) {
      if (this.#overlay) {
        const r = this.#overlayReceipts.get(s[overlayReceipt]);
        if (!r) throw fsOperationError("ENOTSUP",undefined,filePath);
        const path = i < ancestors.length ? ancestors[i].path : i === ancestors.length ? last : filePath;
        if (path === r.path) packed.set(r.stamp,48*i);
        if (i === entries.length - 1) differentType = s.type !== r.type;
        continue;
      }
      const row = this.#memoryReceipt(s);
      if (Number.isNaN(row[0]) && i < entries.length - 2) fail("ENOTSUP");
      packed.set(row,9*i);
    }
    signal?.throwIfAborted();
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const receipt = this._allocBytes(new Uint8Array(packed.buffer));
      try {
        const op = this.#overlay ? this.exports.safe_bash_overlay_chmod : this.exports.safe_bash_chmod_conditional;
        const apply = phase => {
          const rc = op(this.sessionId, p.ptr, p.len, mode === undefined ? 0 : typeof mode === "number" ? mode : NaN, receipt.ptr, receipt.len, phase);
          if (rc === -1) throw new Error("Wasm session unavailable");
          if (rc < 0) throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, this.exports.safe_bash_output_ptr(this.sessionId), -rc)));
        };
        if (guard === undefined) {
          if (differentType) { apply(1); throw fsOperationError("EAGAIN",undefined,filePath); }
          apply(0); return;
        }
        if (this.#overlay) {
          let staged = false;
          try {
            for (const phase of [1,2,3]) {
              const result = guard();
              if (result !== true) { void Promise.resolve(result).catch(() => {}); throw fsOperationError("ENOTSUP",undefined,undefined); }
              signal?.throwIfAborted();
              apply(phase);
              staged = phase === 2;
              if (differentType) throw fsOperationError("EAGAIN",undefined,filePath);
            }
          } finally { if (staged && this.sessionId) apply(4); }
          return;
        }
        apply(1);
        const result = guard();
        if (result !== true) { void Promise.resolve(result).catch(() => {}); fail("ENOTSUP"); }
        signal?.throwIfAborted();
        apply(2);
      } finally { this._freeBytes(receipt); }
    } finally { this._freeBytes(p); }
  }

  setMtime(filePath, mtime) {
    this._setTimes(filePath, 0, mtime, false);
  }

  _setTimes(filePath, atime, mtime, both) {
    this.#requireNativeFs();
    const millis = value => value instanceof Date ? value.getTime() : typeof value === "number" ? value : NaN;
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const rc = this.exports.safe_bash_set_times(this.sessionId, p.ptr, p.len, millis(atime), millis(mtime), both);
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -rc)));
      }
    } finally {
      this._freeBytes(p);
    }
  }

  stat(filePath, follow = true) {
    this.#requireNativeFs();
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const len = this.exports.safe_bash_stat(this.sessionId, p.ptr, p.len, follow ? 1 : 0);
      if (len === -1) throw new Error("Wasm session unavailable");
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      if (len < 0) {
        const error = decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, -len));
        throw readOperationError(error);
      }
      return this._decodeStat(outPtr, len);
    } finally {
      this._freeBytes(p);
    }
  }

  _decodeStat(outPtr, len) {
    const view = new DataView(this.exports.memory.buffer, outPtr, len);
    const kindCode = view.getUint32(0, true);
    const size = view.getUint32(4, true);
    const mode = view.getUint32(8, true);
    const mtimeMs = view.getFloat64(12, true);
    const atimeMs = view.getFloat64(20, true);
    const ctimeMs = view.getFloat64(28, true), birthtimeMs = view.getFloat64(36, true);
    const type = (mode & 0o170000) === 0o020000 ? "character" : kindCode === 1 ? "directory" : kindCode === 2 ? "symlink" : "file";
    const fields = view.getUint32(44, true);
    let token;
    if (fields & 32) {
      const pathLen = view.getUint32(len-4,true);
      len -= pathLen + 52;
      token = {};
      this.#overlayReceipts.set(token, {
        type,
        stamp: new Uint8Array(this.exports.memory.buffer.slice(outPtr+len,outPtr+len+48)),
        path: decoder.decode(new Uint8Array(this.exports.memory.buffer,outPtr+len+48,pathLen)),
      });
    }
    const allocatedBytes = view.getFloat64(60, true), ioBlockSize = view.getFloat64(68, true);
    if (fields & 64) len -= 8;
    const preferredIoBlockSize = fields & 64 ? Number(view.getBigUint64(len, true)) : undefined;
    const revision = fields & 16 ? Number(view.getBigUint64(len - 8, true)) : undefined;
    const identityLength = len - (fields & 16 ? 8 : 0);
    const ino = identityLength >= 92 ? Number(view.getBigUint64(84, true)) : undefined;
    let identityScope;
    if (Number.isSafeInteger(ino)) {
      // Memory filesystems report dev 0. Keep their identity scopes distinct,
      // including synthetic device mounts and logical overlay directories.
      const key = identityLength >= 100 ? view.getBigUint64(92, true) : ~view.getBigUint64(76, true);
      const retained = this.#identityScopes.get(key);
      identityScope = this.#releasedScopes ? retained?.deref() : retained;
      if (!identityScope) {
        identityScope = Symbol("Wasm filesystem identity");
        this.#identityScopes.set(key, this.#releasedScopes ? new WeakRef(identityScope) : identityScope);
        this.#scopeKeys.set(identityScope,key);
        if (this.#releasedScopes) this.#releasedScopes.register(identityScope, key);
      }
    }
    return {
      ...(token ? {[overlayReceipt]:token} : {}),
      ...(Number.isSafeInteger(revision) ? {revision} : {}),
      ...(fields & 1 ? {uid: view.getUint32(48, true)} : {}),
      ...(fields & 2 ? {gid: view.getUint32(52, true)} : {}),
      ...(fields & 4 ? {nlink: view.getUint32(56, true)} : {}),
      ...(fields & 8 ? {filesystemType: "memory"} : {}),
      ...(Number.isFinite(allocatedBytes) ? {allocatedBytes} : {}),
      ...(Number.isFinite(ioBlockSize) ? {ioBlockSize} : {}),
      ...(preferredIoBlockSize !== undefined ? {preferredIoBlockSize} : {}),
      ...(identityScope ? { dev: 0, ino, identityScope } : {}),
      type,
      size,
      mode,
      mtime: new Date(mtimeMs),
      mtimeMs,
      atimeMs,
      ...(Number.isFinite(ctimeMs) ? { ctimeMs } : {}),
      ...(Number.isFinite(birthtimeMs) ? { birthtimeMs } : {}),
      isFile: type === "file",
      isDirectory: type === "directory",
      isSymbolicLink: type === "symlink",
    };
  }

  readdir(dirPath, limit) {
    this.#requireNativeFs();
    const typed = limit !== undefined;
    const p = this._allocBytes(encoder.encode(dirPath));
    try {
      const len = this.exports.safe_bash_readdir(this.sessionId, p.ptr, p.len, typed, limit);
      if (len === -1) throw new Error("Wasm session unavailable");
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      if (len < 0) {
        const text = decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, -len));
        throw readOperationError(text);
      }
      const view = new DataView(this.exports.memory.buffer, outPtr, len);
      const count = view.getUint32(0, true);
      let offset = 4;
      const entries = [];
      for (let i = 0; i < count; i++) {
        const mode = typed ? view.getUint8(offset++) : 0;
        const nameLen = view.getUint32(offset, true);
        offset += 4;
        const name = decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr + offset, nameLen));
        entries.push(typed ? {name, type: mode === 4 ? "directory" : mode === 10 ? "symlink" : mode === 2 ? "character" : "file"} : name);
        offset += nameLen;
      }
      return entries;
    } finally {
      this._freeBytes(p);
    }
  }

  #forkShell() {
    const id = this.exports.safe_bash_fork_session(this.sessionId);
    if (!id) throw new Error("Shell is disposed");
    return new WasmShell(this.exports, id, this.state.cwd, this.state.env, this.ShellLimitError);
  }

  async exec(script, options = {}) {
    if (!this.sessionId) throw new Error("Shell is disposed");
    if (options.onInternalError !== undefined && typeof options.onInternalError !== "function") throw new TypeError("onInternalError must be callable");
    if (this.#hostRoot && options.fs == null) options = {...options, fs: this.#hostRoot};
    if (this.#onInternalError && options.onInternalError === undefined) options = {...options, onInternalError:this.#onInternalError};
    if (!this.#ready) return this.#exec(script, options);
    const signal = options.signal ? AbortSignal.any([options.signal, this.#pluginLifetime.signal]) : this.#pluginLifetime.signal;
    signal.throwIfAborted();
    await untilAbort(this.#ready, signal);
    signal.throwIfAborted();
    const capabilities = Object.freeze({...this.#providedCapabilities,...options.capabilities});
    const run = this.#exec(script, {...options, signal, capabilities}, Boolean(options.signal));
    this.#activePlugins.add(run);
    try { return await run; } finally { this.#activePlugins.delete(run); }
  }

  async #exec(script, options, legacySleep = options.signal) {
    const filesystem = options.fs;
    const externalFs = filesystem != null && (this.#hostRoot != null || filesystem !== this.fs);
    if (externalFs && this.companionFactory && !this._companion) {
      // The call has its own filesystem. It neither needs the default
      // filesystem's history nor transfers ownership of subsequent calls.
      return this.#getCompanion().shell.exec(script, options);
    }
    if (this.companionFactory && (!this.forceNative || this._companion)) {
      if (this._companion || !this.canRunNative(script, options)) {
        this._getOrCreateCompanionSync();
        await this._ensureCompanionSynced();
        const hasOpts = options && Object.keys(options).length > 0;
        return hasOpts
          ? this._companion.shell.exec(script, options)
          : this._companion.shell.exec(script);
      }
    }
    const hostWait = options.signal && typeof WebAssembly.Suspending === "function" && typeof WebAssembly.promising === "function";
    if (legacySleep && !hostWait) {
      options.signal.throwIfAborted();
      const sleepMatch = /\bsleep\s+([0-9.]+)/.exec(script);
      if (sleepMatch) {
        const waitMs = Math.min(Math.max(1, Number(sleepMatch[1]) * 1000), 2000);
        await new Promise((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(t);
            reject(options.signal.reason);
          };
          const t = setTimeout(() => {
            options.signal.removeEventListener("abort", onAbort);
            resolve();
          }, waitMs);
          options.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
    options.signal?.throwIfAborted();
    const shell = this.#forkShell();
    let releaseCommands, releaseFs, elapsedMs, timerHost;
    let res;
    try {
      const before = options.hooks?.beforeExec ?? this.hooks?.beforeExec;
      const env = Object.entries(options.env ?? {});
      if (before && options.state == null) {
        for (const [key, value] of env) validateEnvEntry(key, value);
      }
      const state = options.state ?? (before && await before({source: script, options}));
      options.signal?.throwIfAborted();
      if (options.limits) shell.setLimits(options.limits);
      if (externalFs) {
        if (!WebAssembly.Suspending || !WebAssembly.promising) throw new TypeError("Executing with a host filesystem requires WebAssembly Promise Integration");
        releaseFs=bindExternalFs(shell,filesystem,options);
      }
      if (state !== undefined) shell.restoreSession(state);
      for (const [name, value] of env) {
        shell.setEnv(name, value);
      }
      if (options.cwd !== undefined) shell._setBinding("\0cwd", options.cwd);
      const pi = options.capabilities?.predicateIdentity;
      if (pi?.effectiveUid !== undefined) shell._setBinding("\0euid", String(pi.effectiveUid));
      if (pi?.effectiveGid !== undefined) shell._setBinding("\0egid", String(pi.effectiveGid));
      if (options.limits) {
        const limits = options.limits;
        const sharedKeys = ["maxCommands", "maxLoopIterations", "maxSourceBytes", "maxParseUnits", "maxExpansionBytes", "maxExpansionFields", "maxPipelineStages", "maxPipelineBytes", "maxSubstitutionDepth", "maxFunctionDepth", "maxCpuMs"];
        if (sharedKeys.some(k => limits[k] !== undefined && limits[k] !== Infinity)) shell._setBinding("\0has_finite_shared_quota", "1");
        const split = limits.commandLimits?.split?.maxFiles;
        const html = limits.commandLimits?.htmlToMarkdown?.maxInputBytes;
        if (split !== undefined) shell._setBinding("\0limit_split_max_files", String(split));
        if (html !== undefined) shell._setBinding("\0limit_html_to_markdown_max_input_bytes", String(html));
      }
      let stdinData = options.stdin ?? "";
      const asyncInput = stdinData && typeof stdinData === "object" && !(stdinData instanceof Uint8Array) && Symbol.asyncIterator in stdinData;
      if (this.#commands) {
        const definitions = this.#commands.list();
        if (definitions.length || this.#middleware.length) {
          if (typeof WebAssembly.Suspending !== "function" || typeof WebAssembly.promising !== "function") {
            throw new Error("Standalone JavaScript command handlers require WebAssembly Promise Integration");
          }
          releaseCommands = bindHostCommands(shell, definitions, this.#commandContract, this.#validatePath, this.#diagnostics, this.#bindFileOutputBudget, externalFs ? filesystem : this.fs, externalFs ? filesystem.capabilities?.open===true : !this.#overlay, options, this.#middleware, this.#composeMiddleware,externalFs ? (this.#hostRoot || this.#overlay || this._companion ? null : this.fs) : undefined);
        }
      }
      if (hostWait) {
        timerHost = streamHost(shell.exports);
        if (shell.exports.safe_bash_set_sleep_wait(shell.sessionId, timerHost.slot) !== 0) throw Error("Could not bind sleep timer");
        if (!asyncInput) timerHost.jobs.set(shell.sessionId, {shell, signal:options.signal, top:shell.exports.__stack_pointer.value});
      }
      if (asyncInput && typeof WebAssembly.Suspending === "function" && typeof WebAssembly.promising === "function") {
        res = await execAsyncStdin(shell,script,stdinData,options.signal);
      } else if (releaseCommands || releaseFs || timerHost) {
        const scriptBytes = shell._allocBytes(encoder.encode(script));
        let input;
        try {
          input = shell._allocBytes(typeof stdinData === "string" ? encoder.encode(stdinData) : stdinData);
          // A null pointer means omitted stdin; an explicit empty slice can borrow the script address.
          const ptr = input.ptr || (options.stdin === undefined ? 0 : scriptBytes.ptr);
          await WebAssembly.promising(shell.exports.safe_bash_exec)(shell.sessionId,scriptBytes.ptr,scriptBytes.len,ptr,input.len);
          options.signal?.throwIfAborted();
          res = shell._execResult();
        } finally { shell._freeBytes(scriptBytes); if (input) shell._freeBytes(input); }
      } else {
        if (asyncInput) {
          stdinData = await collectAsyncStdin(stdinData, options.signal);
          options.signal?.throwIfAborted();
        }
        res = shell.execSync(script, options.stdin === undefined ? undefined : stdinData);
      }
      elapsedMs = this.exports.safe_bash_last_elapsed_ms?.(shell.sessionId) >>> 0;
      if (state || options.onState || options.hooks || this.hooks) res.state = shell.snapshot(res.exitCode);
    } finally {
      timerHost?.jobs.delete(shell.sessionId);
      try { if (releaseCommands) await releaseCommands(); } finally { try { if(releaseFs)await releaseFs(); } finally { shell.dispose(); } }
    }
    if (!hostWait && elapsedMs > 0 && res.exitCode !== 1) {
      const waitMs = Math.min(elapsedMs, 50);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    if (options.stdout && typeof options.stdout.write === "function" && res.stdoutBytes.byteLength > 0) {
      await options.stdout.write(res.stdoutBytes);
    }
    if (options.stderr && typeof options.stderr.write === "function" && res.stderrBytes.byteLength > 0) {
      await options.stderr.write(res.stderrBytes);
    }
    if (options.captureOutput === false) {
      res.stdout = res.stderr = "";
      res.stdoutBytes = res.stderrBytes = new Uint8Array(0);
    }
    if (this.companionFactory && !this.forceNative) {
      // Hybrid execution only admits native scripts without per-call options.
      this._history.push({ type: "exec", script });
    }
    if (res.state) {
      await options.onState?.(res.state, res);
      await (options.hooks?.afterExec ?? this.hooks?.afterExec)?.(res.state, res);
    }
    return res;
  }

  canRunNative(script, options) {
    if (!this.companionFactory || this.forceNative) {
      return true;
    }
    if (options && Object.keys(options).length > 0) {
      return false;
    }
    if (!/^[\x09\x0a\x20-\x7e]*$/.test(script)) {
      return false;
    }
    if (/[\\|&;<>()`$'"*?\]{}~!]/.test(script)) {
      return false;
    }
    const lines = script
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const first = parts[0] ?? "";
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first) && parts.length === 1) {
        continue;
      }
      if (!SAFE_DETERMINISTIC_CMDS.has(first)) {
        return false;
      }
    }
    return true;
  }

  #getCompanion() {
    return this.#companion ??= this.companionFactory?.();
  }

  _getOrCreateCompanionSync() {
    return this._companion ??= this.#getCompanion();
  }

  async _ensureCompanionSynced() {
    const comp = this._getOrCreateCompanionSync();
    if (!comp) return;
    if (!this._companionSyncPromise) {
      this._companionSyncPromise = (async () => {
        if (this.companionSeed) {
          await this.companionSeed(comp.fs);
        }
        for (const item of this._history) {
          if (item.type === "fs") {
            await item.run(comp.fs);
          } else if (item.type === "exec") {
            await comp.shell.exec(item.script);
          }
        }
        this._history.length = 0;
      })();
    }
    await this._companionSyncPromise;
  }

  #install(setup) {
    this.#pluginLifetime ??= new AbortController();
    this.#ready = (this.#ready ?? Promise.all([import("safe-bash-contracts/command"), import("safe-bash-contracts/path"), import("safe-bash-contracts/diagnostics"), import("safe-bash-contracts/filesystem-output-budget"), import("safe-bash-contracts/plugin")]).then(([commandContract, {validatePath}, diagnostics, {bindFileOutputBudget}, {composeMiddleware}]) => {
      this.#validatePath = validatePath;
      this.#diagnostics = diagnostics;
      this.#commands = new commandContract.CommandRegistry();
      this.#commandContract = commandContract;
      this.#composeMiddleware = composeMiddleware;
      this.#bindFileOutputBudget = bindFileOutputBudget;
    })).then(setup);
    this.#ready.catch(() => {});
  }

  use(plugin) {
    this.#pluginLifetime?.signal.throwIfAborted();
    if (!this.sessionId) throw new Error("Shell is disposed");
    if (this.companionFactory) {
      this.forceNative = false;
      this._getOrCreateCompanionSync().shell.use(plugin);
    } else if (typeof plugin === "function") {
      this.#install(()=>{this.#middleware.push(plugin);});
    } else {
      if (typeof plugin?.setup !== "function") throw new TypeError("Expected a shell plugin with setup");
      this.#install(async () => {
        await plugin.setup({commands:this.#commands, use: middleware => {
          if (this.#pluginLifetime.signal.aborted) throw new Error("Shell is disposed");
          if (typeof middleware !== "function") throw new TypeError("Expected middleware function");
          this.#middleware.push(middleware);
        }, registerFileSystem:(scheme, factory) => this.#registerFileSystem(scheme, factory),
          provideCapabilities: defaults => {
            if (this.#pluginLifetime.signal.aborted) throw new Error("Shell is disposed");
            this.#providedCapabilities = {...this.#providedCapabilities,...defaults};
          },
        });
        this.#plugins.push(plugin);
      });
    }
    return this;
  }

  register(cmd, options) {
    this.#pluginLifetime?.signal.throwIfAborted();
    if (!this.sessionId) throw new Error("Shell is disposed");
    if (this.companionFactory) {
      this.forceNative = false;
      this._getOrCreateCompanionSync().shell.register(cmd, options);
    } else this.#install(() => { this.#commands.register(cmd, options); });
    return this;
  }

  execSync(script, stdin) {
    this.#requireNativeFs();
    if (this.#ready) throw new Error("Use exec() after installing a JavaScript plugin");
    return super.execSync(script, stdin);
  }

  registerFileSystem(scheme, factory) {
    this.#pluginLifetime?.signal.throwIfAborted();
    if (!this.sessionId) throw new Error("Shell is disposed");
    if (this.companionFactory) {
      this.#getCompanion().shell.registerFileSystem(scheme, factory);
      return;
    }
    this.#registerFileSystem(scheme, factory);
  }

  #registerFileSystem(scheme, factory) {
    if (!this.sessionId) throw new Error("Shell is disposed");
    if (!/^[a-z][a-z0-9+.-]*$/u.test(scheme)) throw new TypeError("Invalid filesystem scheme");
    if (this.#filesystems.has(scheme)) throw new Error(`Filesystem already registered: ${scheme}`);
    this.#filesystems.set(scheme, factory);
  }

  async createFileSystem(scheme, options = {}) {
    this.#pluginLifetime?.signal.throwIfAborted();
    if (!this.sessionId) throw new Error("Shell is disposed");
    if (!this.companionFactory) {
      if (this.#ready) await this.#ready;
      const factory = this.#filesystems.get(scheme);
      if (!factory) throw new Error(`Unknown filesystem scheme: ${scheme}`);
      return factory(options);
    }
    if (!this.forceNative || this._companion) await this._ensureCompanionSynced();
    return this.#getCompanion().shell.createFileSystem(scheme, options);
  }

  createSession(initialState) {
    this.#pluginLifetime?.signal.throwIfAborted();
    if (this.companionFactory && !this.forceNative) {
      const comp = this._getOrCreateCompanionSync();
      const inner = comp.shell.createSession(initialState);
      const self = this;
      return {
        get state() {
          return inner.state;
        },
        set state(val) {
          inner.state = val;
        },
        dispose() { return inner.dispose(); },
        async exec(script, opts) {
          await self._ensureCompanionSynced();
          if (self.#hostRoot && opts?.fs == null) opts = {...opts, fs:self.#hostRoot};
          return opts === undefined ? inner.exec(script) : inner.exec(script, opts);
        },
      };
    }
    if (!this.sessionId) throw new Error("Shell is disposed");
    if (initialState && "rawHistory" in initialState) throw new TypeError("Command history cannot restore a shell session");
    const owner = this;
    const controller = new AbortController();
    this.#sessions.add(controller);
    let tail = Promise.resolve();
    const session = {
      state: initialState,
      async dispose() {
        controller.abort(new Error("Shell session is disposed"));
        owner.#sessions.delete(controller);
        await tail;
      },
      exec(script, opts = {}) {
        const turn = tail.then(() => {
          controller.signal.throwIfAborted();
          return owner.exec(script, {
            ...opts,
            signal: opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal,
            state: opts.state ?? session.state,
            async onState(state, result) {
              session.state = state;
              await opts.onState?.(state, result);
            },
          });
        });
        tail = turn.catch(() => {});
        return turn;
      },
    };
    return session;
  }

  dispose() {
    if (this.#disposal) return this.#disposal;
    if (this.#companion && this.sessionId) void this.#companion.shell.dispose();
    if (this.#ready) {
      // Publish the disposal promise before abort listeners can reenter dispose().
      this.#disposal = Promise.resolve().then(async () => {
        await Promise.allSettled([this.#ready, ...this.#activePlugins]);
        const failures = [];
        for (const plugin of this.#plugins.splice(0).reverse()) {
          try { await plugin.dispose?.(); } catch (error) { failures.push(error); }
        }
        this.#middleware.length = 0;
        this.#providedCapabilities = undefined;
        this.#filesystems.clear();
        this.#identityScopes.clear();
        super.dispose();
        if (failures.length) throw new AggregateError(failures, "Plugin disposal failed");
      });
      this.#pluginLifetime.abort(new Error("Shell is disposed"));
    }
    for (const controller of this.#sessions) controller.abort(new Error("Shell session is disposed"));
    this.#sessions.clear();
    if (this.#disposal) return this.#disposal;
    this.#filesystems.clear();
    this.#identityScopes.clear();
    super.dispose();
  }
}

export function createRustWasmBash(options = {}) {
  const loaded = createWasmInstance();
  return loaded instanceof Promise
    ? loaded.then(instance => new RustWasmBash(options, instance))
    : new RustWasmBash(options, loaded);
}
