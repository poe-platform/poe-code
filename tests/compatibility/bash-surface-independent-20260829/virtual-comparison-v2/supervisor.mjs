import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {authenticated,Storage,runChild,census,digest} from './mechanism.mjs';
import {installSources,installTools,installTypes,admittedPackage,extractValidatedTar,verifyMembers,writeExclusive} from './setup.mjs';
const ownFiles=['case-driver.mjs','case-adapter.mjs','data.mjs','guard.mjs','loader.mjs'];
function pinNode(pin){const before=fs.lstatSync(pin.path);if(!before.isFile()||before.isSymbolicLink()||before.size!==pin.bytes||(before.mode&4095)!==pin.mode)throw Error('NODE_TYPE_SIZE');const fd=fs.openSync(pin.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),hash=createHash('sha256'),buffer=Buffer.alloc(65536);let total=0;try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;if(total>pin.bytes)throw Error('NODE_LONG');hash.update(buffer.subarray(0,count));}}finally{fs.closeSync(fd);}if(total!==pin.bytes||hash.digest('hex')!==pin.sha256)throw Error('NODE_HASH');}
export async function run({packet,work,seal,grant,started,ownerLog}){
 const finalDeadline=Math.min(started+1800000,grant.notAfterEpochMs),bodyDeadline=finalDeadline-120000;
 const storage=new Storage(path.join(work,'capture'),{bodyDeadline,finalDeadline,maximum:536870912});
 const tools=JSON.parse(authenticated(path.join(packet,'TOOLS.json'),seal.files['TOOLS.json']));pinNode(tools.node);
 const matrix=JSON.parse(authenticated(path.join(packet,'MATRIX.json'),seal.files['MATRIX.json']));const members=JSON.parse(authenticated(path.join(packet,'PACKAGE-MEMBERS.json'),seal.files['PACKAGE-MEMBERS.json']));const staticEdges=JSON.parse(authenticated(path.join(packet,'STATIC-EDGES.json'),seal.files['STATIC-EDGES.json'])).edges;
 const ledger={maximum:143,peak:2,active:0,starts:0,captureBytes:0,captureMaximum:134217728,observedPeak:0,rows:[],stopped:false};const records=[],layouts=[];let loaderRequests=0,primary={present:false};
 const freshEnv=()=>({HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp'),PATH:path.join(work,'empty-path'),LC_ALL:'C',LANG:'C',TZ:'UTC'});
 for(const name of ['home','tmp','empty-path'])fs.mkdirSync(path.join(work,name),{mode:0o700});
 const deadlineCheck=()=>{storage.check();census(work,536870912);};
 const launch=async(label,args,cwd,timeoutMs,extraEnv={})=>{deadlineCheck();pinNode(tools.node);const result=await runChild({label,executable:tools.node.path,args,cwd,env:{...freshEnv(),...extraEnv},capture:path.join(work,'capture',label),timeoutMs,bodyDeadline,finalDeadline,streamLimit:label.startsWith('case-')?1114112:65536},ledger);if(!result.row.qualified)throw Error('CHILD_UNQUALIFIED:'+label);return result.row;};
 try{
  const setupStart=Date.now();installSources(packet,work,seal);installTools(tools,work);const sourceApp=path.join(work,'source-app');installTypes(tools,work,sourceApp);
  if(Date.now()-setupStart>=180000)throw Error('SETUP_AGGREGATE_DEADLINE');
  const build=await launch('build',[path.join(work,'tools/typescript/bin/tsc'),'-p',path.join(sourceApp,'tsconfig.build.json')],sourceApp,180000-(Date.now()-setupStart));if(build.status!==0)throw Error('BUILD_STATUS');
  for(const member of members)authenticated(path.join(sourceApp,member.path),member);
  verifyMembers(path.join(sourceApp,'dist'),members.filter(row=>row.path.startsWith('dist/')).map(row=>({...row,path:row.path.slice(5)})));
  const archive=await admittedPackage(seal.archive.path,seal.archive,members);storage.file('ARCHIVE-ADMISSION.json',Buffer.from(JSON.stringify({receipt:archive.receipt,ledger:archive.ledger,events:archive.events})+'\n'));
  const installedApp=path.join(work,'installed-app');extractValidatedTar(archive.buffer,path.join(installedApp,'node_modules/virtual-bash'));archive.buffer=undefined;verifyMembers(path.join(installedApp,'node_modules/virtual-bash'),members);installTypes(tools,work,installedApp);
  if(Date.now()-setupStart>=180000)throw Error('SETUP_AGGREGATE_DEADLINE');
  let typeRemaining=180000;
  for(const layout of ['source-built','installed','physically-moved']){
   const app=layout==='source-built'?sourceApp:layout==='installed'?installedApp:path.join(work,'moved-app');
   if(layout==='physically-moved'){fs.renameSync(installedApp,app);if(fs.existsSync(installedApp))throw Error('MOVE_OLD_PARENT_PRESENT');}
   const packageRoot=layout==='source-built'?app:path.join(app,'node_modules/virtual-bash');
   if(layout!=='source-built')verifyMembers(packageRoot,members);
   for(const filename of ownFiles){const destination=path.join(app,filename);if(layout!=='physically-moved')writeExclusive(destination,authenticated(path.join(packet,filename),seal.files[filename]));}
   const consumer='import {Shell,MemoryFileSystem,agentCommands,type ShellResult} from '+JSON.stringify(layout==='source-built'?'./dist/index.js':'virtual-bash')+';\nconst fs=new MemoryFileSystem();const shell=new Shell({fs,env:{LC_ALL:"C"}}).use(agentCommands());const result:Promise<ShellResult>=shell.exec("",{stdin:new Uint8Array(),signal:new AbortController().signal});void result;void shell.dispose;\n';
   if(layout!=='physically-moved')writeExclusive(path.join(app,'consumer.mts'),Buffer.from(consumer));
   const typeStart=Date.now();if(typeRemaining<=0)throw Error('TYPECHECK_AGGREGATE_DEADLINE');const typed=await launch('types-'+layout,[path.join(work,'tools/typescript/bin/tsc'),'--noEmit','--strict','--exactOptionalPropertyTypes','--target','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--types','node',path.join(app,'consumer.mts')],app,typeRemaining);typeRemaining-=Date.now()-typeStart;if(typed.status!==0)throw Error('TYPECHECK_STATUS');
   const filePins={},edges={};for(const member of members.filter(row=>row.path.endsWith('.js'))){filePins[path.join(packageRoot,member.path)]=member;edges[path.join(packageRoot,member.path)]=staticEdges[member.path]??[];}for(const name of ownFiles)filePins[path.join(app,name)]=seal.files[name];edges[path.join(app,'case-driver.mjs')]=['node:fs','node:url','./case-adapter.mjs','./data.mjs','virtual-bash',pathToFileURL(path.join(packageRoot,'dist/index.js')).href];edges[path.join(app,'case-adapter.mjs')]=['node:crypto','node:path'];edges[path.join(app,'data.mjs')]=['node:crypto'];
   layouts.push({layout,app,packageRoot,packageMembers:954,oldInstalledParentAbsent:layout==='physically-moved'?!fs.existsSync(installedApp):undefined});
   for(const row of matrix.cases){
    if(++loaderRequests>111)throw Error('LOADER_RESERVATION');const id=layout+'-'+row.id,mainTrace=path.join(work,'capture',id+'.main.trace'),loaderTrace=path.join(work,'capture',id+'.loader.trace');writeExclusive(mainTrace,Buffer.alloc(0));writeExclusive(loaderTrace,Buffer.alloc(0));
    const role={id,caseId:row.id,layout,matrix:path.join(packet,'MATRIX.json'),productEntry:path.join(packageRoot,'dist/index.js'),loader:path.join(app,'loader.mjs'),files:filePins,edges,builtins:seal.builtins,regexWorkerPermission:0,mainTrace,loaderTrace};const roleBytes=Buffer.from(JSON.stringify(role)+'\n'),rolePath=path.join(work,'capture',id+'.role.json');writeExclusive(rolePath,roleBytes);
    const outcome=await launch('case-'+id,['--import',path.join(app,'guard.mjs'),path.join(app,'case-driver.mjs')],app,8000,{SURFACE_ROLE:rolePath,SURFACE_ROLE_SHA256:digest(roleBytes)});
    if(outcome.status!==0)throw Error('CASE_DRIVER_STATUS:'+id);const raw=outcome.captures.find(value=>value.name==='stdout');const observation=JSON.parse(Buffer.from(raw.base64,'base64'));
    if(observation.caseId!==row.id||observation.layout!==layout)throw Error('CASE_IDENTITY');
    const traces=[];for(const tracePath of [mainTrace,loaderTrace]){const stat=fs.lstatSync(tracePath);if(!stat.isFile()||stat.size>524288)throw Error('TRACE_LIMIT');const bytes=fs.readFileSync(tracePath);ledger.captureBytes+=bytes.length;if(ledger.captureBytes>ledger.captureMaximum)throw Error('CAPTURE_LIMIT');for(const line of bytes.toString().trim().split('\n').filter(Boolean))traces.push(JSON.parse(line));}
    if(traces.some(value=>value.event==='regex-worker-refused-before-acquisition')||traces.filter(value=>value.event==='loader-initialized').length!==1||traces.filter(value=>value.event==='loader-registration-requested').length!==1||!traces.some(value=>value.event==='module-loaded'&&value.url===pathToFileURL(role.productEntry).href))throw Error('LOAD_OR_WORKER_AUTHORITY');
    records.push({id,observation,loaded:traces,retirement:outcome.group});storage.file(id+'.json',Buffer.from(JSON.stringify(records.at(-1),null,2)+'\n'));deadlineCheck();
   }
  }
 }catch(reason){primary={present:true,reason};ledger.stopped=true;ownerLog({event:'PRIMARY_STOP',reason:reason instanceof Error?reason.message:typeof reason});}
 const result={schema:'virtual-comparison-actual-v2',candidate:seal.candidate,packageSha256:seal.archive.sha256,completed:records.length,planned:111,unrun:111-records.length,primaryPresent:primary.present,primary:primary.present?(primary.reason instanceof Error?{name:primary.reason.name,message:primary.reason.message}: {kind:typeof primary.reason}):undefined,layouts,ledger,loaderRegistrationRequests:loaderRequests,regexWorkerStarts:0,qualification:'Known managed direct processes and observed loader registration/load traces; loader exits not independently witnessed. Parent process retirement is separate. No OS containment, RSS or universal census.',sampledWork:census(work,536870912)};
 storage.terminal('TERMINAL.json',result);return result;
}
