import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export const workerIdentities=Object.freeze(Array.from({length:25},(_,index)=>'W'+String(index+1).padStart(2,'0')));
export async function runWorkerCase({moduleRoot,adapter,realRoot},id,publish) {
  assert(workerIdentities.includes(id));
  const load=relative=>import(pathToFileURL(moduleRoot+'/'+relative).href);
  const {createNodeCommand,createNodeWorkerProvider}=await load('commands/node/index.js');
  const {MemoryFileSystem}=await load('fs/memory/index.js');
  const {ReadOnlyFileSystem}=await load('fs/readonly/index.js');
  const {RealFileSystem}=await load('fs/real/index.js');
  const {Shell}=await load('shell/shell.js');
  const fs=id==='W24'?new RealFileSystem({root:realRoot}):new MemoryFileSystem();
  const bytes=value=>new TextEncoder().encode(value);const decode=value=>new TextDecoder().decode(value);
  const events=[];const registered=[];const controller=new AbortController();const output={stdout:[],stderr:[]};
  const counts={fsRead:0,fsWrite:0,realpath:0,pulls:0,parentCleanup:0,prepares:0,starts:0};let actualRetirement;let args=['-e',''];let cwd='/';let env={};let grants={stdoutWrite:true,stderrWrite:true};let expected=0;let stdout='';let rawPresent=false;let rawReason;let callerTriggered=false;
  const observerReason=new Error('after-acquisition-observer');const sinkReason={tag:'sink-rejection'};
  const sink=channel=>({write:async chunk=>{assert(chunk instanceof Uint8Array);assert(output[channel].reduce((sum,item)=>sum+item.byteLength,0)+chunk.byteLength<=65536);output[channel].push(Uint8Array.from(chunk));}});
  const context={command:'node',args,stdin:{async *[Symbol.asyncIterator](){counts.pulls+=1;}},stdout:sink('stdout'),stderr:sink('stderr'),cwd,env,fs,signal:controller.signal,registerCleanup:cleanup=>registered.push(cleanup)};
  if(id==='W02'){args=['-p','1+2'];stdout='3\n';}
  if(id==='W03'){await fs.mkdir('/project');await fs.writeFile('/project/entry.cjs',bytes("console.log(process.argv[0],process.argv[1],process.argv[2],process.env.MARK,require('path').dirname(__filename),__dirname);"));args=['/project/entry.cjs','tail'];env={MARK:'bound'};grants.sourceRead=true;stdout='/virtual/bin/node /project/entry.cjs tail bound /project /project\n';}
  if(id==='W04'){args=[];grants.sourceRead=true;grants.stdinRead=true;context.stdin={async *[Symbol.asyncIterator](){counts.pulls+=1;yield bytes("console.log(require('fs').readFileSync(0,'utf8')); ");}};stdout='\n';}
  if(id==='W05'){await fs.writeFile('/data.json',bytes('\ufeff{"name":"é","n":1}'));args=['-e',"const fs=require('fs');const value=JSON.parse(fs.readFileSync('/data.json','utf8').slice(1));value.n+=1;fs.writeFileSync('/data.json',JSON.stringify(value),'utf8');console.log(fs.readFileSync('/data.json','utf8')); "];grants.dataRead=true;grants.dataWrite=true;stdout='{"name":"é","n":2}\n';}
  if(id==='W06'){await fs.writeFile('/data.json',bytes('{"n":1}'));await fs.symlink('/data.json','/alias.json');args=['-e',"const fs=require('fs');const first=require('./data.json');fs.writeFileSync('/data.json','{\"n\":2}');const second=require('./alias.json');console.log(first===second,second.n);"];grants.dataRead=true;grants.dataWrite=true;grants.jsonModules=true;stdout='true 1\n';}
  if(id==='W07'){args=['-e',"try{require('fs').writeFileSync('/denied','x');}catch(error){console.log(error.code);}"];stdout='ERR_VNODE_DENIED\n';}
  if(id==='W08'){args=['-e',"try{require('fs').readFileSync('/missing','utf8');}catch(error){console.log(error.name,error.code,error.path);}"];grants.dataRead=true;stdout='FsError ENOENT /missing\n';}
  if(id==='W09'){rawPresent=true;rawReason={name:'FsError',message:'ordinary object',code:'ENOENT',errno:-2};fs.readFile=async()=>{throw rawReason;};args=['-e',"require('fs').readFileSync('/missing','utf8');"];grants.dataRead=true;}
  if(id==='W10'){context.fs=new ReadOnlyFileSystem(fs);args=['-e',"try{require('fs').writeFileSync('/readonly','x');}catch(error){console.log(error.code);}"];grants.dataWrite=true;stdout='EROFS\n';}
  if(id==='W11'){await fs.writeFile('/existing',bytes('before'));args=['-e',"try{require('fs').writeFileSync('/existing','after',{encoding:'utf8',flag:'wx'});}catch(error){console.log(error.code);}"];grants.dataWrite=true;stdout='EEXIST\n';}
  if(id==='W12'){args=['-e',"let refused=0;try{'a'.toUpperCase();}catch{refused+=1;}try{[1].reduce(value=>value);}catch{refused+=1;}try{process.env.VALUE=1;}catch{refused+=1;}try{const values=[1];values[4]=2;}catch{refused+=1;}console.log(refused,typeof Math);"];stdout='4 undefined\n';}
  if(id==='W13'){args=['-e',"function plus(value){return value+1;}console.log(JSON.stringify([1,2].map(plus)),require('path').join('/a','b'),' x '.trim());"];stdout='[2,3] /a/b x\n';}
  if(id==='W14'){args=['-e',"Promise.race([]);console.log('entry-return');"];stdout='entry-return\n';}
  if(id==='W15'){rawPresent=true;rawReason=false;fs.readFile=async(path,options)=>new Promise((resolve,reject)=>{const abort=()=>{callerTriggered=true;reject(options.signal.reason);};options.signal.addEventListener('abort',abort,{once:true});controller.abort(false);if(options.signal.aborted&&!callerTriggered)abort();});args=['-e',"require('fs').readFileSync('/held','utf8');"];grants.dataRead=true;}
  if(id==='W16'){rawPresent=true;rawReason=sinkReason;context.stdout={write:async()=>{throw sinkReason;}};args=['-e',"require('fs').writeFileSync('/committed','kept');console.log('fails');"];grants.dataWrite=true;}
  if(id==='W17'){args=['-p','({value:1})'];expected=2;}
  if(id==='W18'){args=['-e',"const error=new Error('guest-only');error.code='ERR_VNODE_PROFILE';throw error;"];expected=1;}
  if(id==='W19'){args=['-p','1+2'];stdout='3\n';}
  if(id==='W20'){await fs.mkdir('/child');args=['-e',"console.log(process.cwd(),process.env.MARK);process.env.MARK='guest';"];stdout='/child child\n';}
  if(id==='W21'){rawPresent=true;rawReason=observerReason;}
  if(id==='W22'){expected=2;}
  if(id==='W23'){args=['-e','while(true){}'];expected=2;}
  if(id==='W24'){await fs.writeFile('/data.json',bytes('{"n":41}'));args=['-e',"const fs=require('fs');const value=JSON.parse(fs.readFileSync('/data.json','utf8'));value.n+=1;fs.writeFileSync('/data.json',JSON.stringify(value));console.log(value.n);"];grants.dataRead=true;grants.dataWrite=true;stdout='42\n';}
  if(id==='W25'){rawPresent=true;rawReason=undefined;}
  context.args=args;context.cwd=cwd;context.env=env;
  const auditRead=fs.readFile.bind(fs);
  for(const [name,counter] of [['readFile','fsRead'],['writeFile','fsWrite'],['realpath','realpath']]){const original=context.fs[name].bind(context.fs);context.fs[name]=async(...args)=>{counts[counter]+=1;return original(...args);};}
  assert(adapter.endsWith('/engine-adapter-v1.mjs'));
  const entry=id==='W01'?adapter.slice(0,-'engine-adapter-v1.mjs'.length)+'engine-adapter-noise-v1.mjs':adapter;
  const reference=createNodeWorkerProvider({entry:pathToFileURL(entry).href,identity:id==='W22'||id==='W25'?'wrong-identity':'author-public-bb23-node-adapter-v1',observe:event=>{assert(events.length<1024);events.push(event);if(id==='W21'&&event.kind==='workerCreated')throw observerReason;if(id==='W25'&&event.kind==='workerExit')throw undefined;}});
  const provider={profile:reference.profile,identity:reference.identity,prepare(request,services){counts.prepares+=1;const session=reference.prepare(request,services);return {start(){counts.starts+=1;return session.start();},cancel:session.cancel,async retire(){actualRetirement=await session.retire();return actualRetirement;}};}};
  const command=createNodeCommand({provider,grants});let outcome;let shell;let cleanupFailed=false;
  try {
    if(id==='W19'||id==='W20'){
      shell=new Shell({fs:context.fs,cwd:'/',env:{MARK:'parent'}});shell.register(command);
      if(id==='W20')shell.register({name:'node-child',execute:async parent=>{assert(parent.invoke);const before=parent.env.MARK;const result=await parent.invoke('node',args,{cwd:'/child',env:{MARK:'child'},replaceEnv:true});assert.equal(parent.cwd,'/');assert.equal(parent.env.MARK,before);return result;}});
      const result=await shell.exec(id==='W19'?"node -p '1+2'":'node-child');outcome={kind:'return',value:{exitCode:result.exitCode}};output.stdout.push(bytes(result.stdout));output.stderr.push(bytes(result.stderr));
    }else outcome={kind:'return',value:await command.execute(context)};
  }catch(reason){outcome={kind:'throw',value:reason};}
  finally{const closures=await Promise.allSettled(registered.map(cleanup=>cleanup()));cleanupFailed=closures.some(result=>result.status==='rejected');if(shell)try{await shell.dispose();}catch{cleanupFailed=true;}counts.parentCleanup+=1;}
  const census=kind=>events.filter(event=>event.kind===kind).length;
  let assertionFailure;
  try {
  assert.equal(census('workerCreated'),1);assert.equal(census('workerExit'),1);assert.equal(census('retired'),1);assert.equal(counts.parentCleanup,1);
  assert(events.findIndex(event=>event.kind==='workerExit')<events.findIndex(event=>event.kind==='retired'));
  assert.equal(census('guestEntry'),id==='W21'||id==='W22'||id==='W25'?0:1);
  assert.equal(census('engineAttempt'),id==='W21'||id==='W22'||id==='W25'?0:1);
  if(rawPresent){assert.equal(outcome.kind,'throw');assert.equal(outcome.value,rawReason);}else{assert.equal(outcome.kind,'return');assert.equal(outcome.value.exitCode,expected);assert.equal(Buffer.concat(output.stdout).toString('utf8'),stdout);}
  if(!rawPresent&&expected===0)assert.equal(Buffer.concat(output.stderr).toString('utf8'),'');
  if(id==='W01'||id==='W02')assert.equal(counts.pulls,0);
  if(id==='W04')assert.equal(counts.pulls,1);
  if(id==='W06'){assert.equal(counts.realpath,2);assert.equal(counts.fsRead,1);assert.equal(decode(await auditRead('/data.json')),'{"n":2}');}
  if(id==='W07')assert.equal(counts.fsWrite,0);
  if(id==='W11')assert.equal(decode(await auditRead('/existing')),'before');
  if(id==='W15')assert(callerTriggered);
  if(id==='W16')assert.equal(decode(await auditRead('/committed')),'kept');
  if(id==='W23')assert.equal(census('engineLimit'),1);
  if(id==='W24')assert.equal(decode(await auditRead('/data.json')),'{"n":42}');
  } catch(error) { const descriptor=error!==null&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'message'):undefined;assertionFailure=descriptor&&typeof descriptor.value==='string'?descriptor.value.slice(0,2048):'non-data assertion failure'; }
  const noAcquisition=counts.prepares===0||actualRetirement?.acquisition==='none';
  const clean=!cleanupFailed&&(noAcquisition&&census('workerCreated')===0&&census('workerExit')===0||actualRetirement?.acquisition==='exited'&&census('workerCreated')===1&&census('workerExit')===1&&census('retired')===1);
  const result={id,pass:assertionFailure===undefined&&clean,clean,noAcquisition,actualRetirement:actualRetirement??null,assertionFailure:assertionFailure??null,expected:rawPresent?'raw-rejection':expected,actual:outcome.kind==='return'?outcome.value.exitCode:'raw-rejection',rawIdentity:rawPresent?outcome.kind==='throw'&&outcome.value===rawReason:null,workers:census('workerCreated'),engineAttempts:census('engineAttempt'),guestEntries:census('guestEntry'),entryReturns:census('entryReturn'),requests:census('request'),postcopy:census('delivered'),exits:census('workerExit'),retired:census('retired'),counts,stdout:Buffer.concat(output.stdout).toString('utf8'),stderr:Buffer.concat(output.stderr).toString('utf8'),events};await publish(result);return result;
}
