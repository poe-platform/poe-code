import {createHash} from 'node:crypto';
import {posix} from 'node:path';
export const limits=Object.freeze({maxOutputBytes:131072,maxCommands:512,maxLoopIterations:4096,maxSubstitutionDepth:32,maxSourceBytes:65536,maxExpansionFields:16384,maxExpansionBytes:1048576,pipeHighWaterMark:65536});
function capture() {
 const chunks=[];let size=0;
 return {sink:{async write(chunk){if(!(chunk instanceof Uint8Array)||size+chunk.byteLength>65536)throw Error('ADAPTER_CAPTURE_LIMIT');const owned=Buffer.from(chunk);size+=owned.length;chunks.push(owned);}},result(){const bytes=Buffer.concat(chunks,size);return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')};}};
}
async function snapshot(fs,root) {
 const rows=[];let total=0;
 async function visit(path,relative,depth) {
  if(depth>16||rows.length>=128)throw Error('SNAPSHOT_LIMIT');
  const stat=await fs.lstat(path);const row={path:relative,type:stat.type,mode:stat.mode&4095};rows.push(row);
  if(stat.type==='file') {if(stat.size>65536||total+stat.size>262144)throw Error('SNAPSHOT_BYTES');const bytes=await fs.readFile(path);if(bytes.length!==stat.size)throw Error('SNAPSHOT_CHANGED');total+=bytes.length;row.base64=Buffer.from(bytes).toString('base64');}
  else if(stat.type==='directory') {const entries=await fs.readdir(path);if(entries.length+rows.length>128)throw Error('SNAPSHOT_ENTRIES');entries.sort((left,right)=>Buffer.compare(Buffer.from(left.name),Buffer.from(right.name)));for(const entry of entries){if(!entry.name||entry.name==='.'||entry.name==='..'||entry.name.includes('/'))throw Error('SNAPSHOT_NAME');await visit(path+'/'+entry.name,relative+'/'+entry.name,depth+1);}}
  else if(stat.type==='symlink')row.target=await fs.readlink(path);
 }
 const entries=await fs.readdir(root);if(entries.length>128)throw Error('SNAPSHOT_ENTRIES');for(const entry of entries)await visit(root+'/'+entry.name,entry.name,0);
 return rows.sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));
}
export async function runCase(api,row,fixtures,signal) {
 const fs=new api.MemoryFileSystem();const cwd=row.virtualInvocation.cwd,caseRoot=posix.dirname(cwd);
 await fs.mkdir(caseRoot,{recursive:true,mode:448});
 for(const name of ['work','home','tmp','empty-path'])await fs.mkdir(caseRoot+'/'+name,{mode:448});
 for(const fixture of fixtures)await fs.writeFile(cwd+'/'+fixture.path,new Uint8Array(Buffer.from(fixture.base64,'base64')),{mode:fixture.mode,flag:'wx'});
 const filesBefore=await snapshot(fs,caseRoot),stdout=capture(),stderr=capture();
 const shell=new api.Shell({fs,cwd,env:row.virtualInvocation.environment,limits}).use(api.agentCommands());
 const publicEvents=[]; let settlement,primary,hasPrimary=false,cleanupError,hasCleanupError=false;
 try {publicEvents.push("exec-started");const result=await shell.exec(row.program,{stdin:new Uint8Array(Buffer.from(row.stdinBase64,'base64')),signal,stdout:stdout.sink,stderr:stderr.sink});publicEvents.push('exec-resolved');settlement={kind:'resolved',status:result.exitCode};const out=stdout.result(),err=stderr.result();if(!Buffer.from(result.stdoutBytes).equals(Buffer.from(out.base64,'base64'))||!Buffer.from(result.stderrBytes).equals(Buffer.from(err.base64,'base64')))throw Error('CAPTURE_RESULT_DISAGREEMENT');}
 catch(reason){publicEvents.push("exec-rejected");hasPrimary=true;primary=reason;settlement={kind:'rejected',reasonKind:reason===null?'null':typeof reason,reasonName:reason instanceof Error?reason.name:undefined,reasonMessage:reason instanceof Error?reason.message:typeof reason==='string'?reason:undefined};}
 finally{publicEvents.push("dispose-started");try{await shell.dispose();publicEvents.push("dispose-resolved");}catch(reason){publicEvents.push("dispose-rejected");hasCleanupError=true;cleanupError=reason;}}
 const filesAfter=await snapshot(fs,caseRoot);
 return {...settlement,stdout:stdout.result(),stderr:stderr.result(),filesBefore,filesAfter,cleanup:{attempted:true,settled:true,rejected:hasCleanupError},publicSettlement:{execObserved:true,disposeSettled:true,disposeRejected:hasCleanupError,events:publicEvents,registeredCleanupQualification:'accepted public exec/dispose contract; no private job census or additional middleware',privateOutstandingJobs:'NOT_OBSERVED'},hasPrimary,primary,hasCleanupError,cleanupError,filesystemScope:'caseRoot descendants only; not host containment or complete VFS mutation census'};
}
