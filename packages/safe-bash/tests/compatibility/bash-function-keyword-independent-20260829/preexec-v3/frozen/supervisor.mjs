import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {readPinned,pinExecutable,hash,publish,Primary,errorRecord} from './auth.mjs';
import {runDirect} from './direct-child.mjs';
import {PROFILE,caseArguments,completion} from './profile.mjs';
import {write,inventory,sample,pack,extract} from './package.mjs';
import {admitPackage} from './package-admission.mjs';
import {validateTar} from './parse-manifest.mjs';
import {finalize} from './finalization.mjs';
import {validateCanonicalRole} from './canonical.mjs';
export async function run(packet,seal,started){
 const work=seal.work,finalDeadline=Math.min(started+1500000,seal.activationDeadline),bodyDeadline=finalDeadline-60000;
 if(fs.realpathSync(work)!==work||!work.startsWith('/private/tmp/'))throw Error('NONCANONICAL_WORK');
 const primary=new Primary(),ledger={starts:1,maximum:64,active:0,stopped:false,captureBytes:196608,ownerCaptureReservation:196608,captureMaximum:100663296,rows:[]};
 const result={schema:'b35-author-result-v1',source:seal.sourceCommit,composition:seal.composition,started,finalDeadline,bodyDeadline,observations:[],mutants:[],refusals:[],types:[],samples:[],claims:{profile:PROFILE,groupAbsence:false,wholeCensus:false,osContainment:false,sourceCompositionAccepted:false,regexWorkerJobs:0,asyncLoaderThreads:0}};
 const record=(name,value)=>{const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');if(ledger.captureBytes+bytes.length>ledger.captureMaximum)throw Error('PUBLICATION_CAPTURE_LIMIT');ledger.captureBytes+=bytes.length;return publish(path.join(work,'capture',name+'.json'),bytes,finalDeadline);};
 const check=()=>{if(Date.now()>=bodyDeadline||ledger.stopped)throw Error('ADMISSION_STOP');result.samples.push(sample(work,536870912));};
 const env=()=>({HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp'),PATH:path.join(work,'empty-path'),LC_ALL:'C',LANG:'C',TZ:'UTC'});
 try{
  for(const [name,pin]of Object.entries(seal.files))readPinned(path.join(packet,name),pin);
  const tools=JSON.parse(readPinned(path.join(packet,'TOOLS.json'),seal.files['TOOLS.json']));pinExecutable(tools.node);
  for(const tool of tools.packages)for(const pin of tool.rows){const original=path.join(tool.resolved,pin.path);const bytes=readPinned(original,pin);if((fs.lstatSync(original).mode&4095)!==pin.mode)throw Error('TOOL_MODE');write(path.join(work,'tools',tool.name,pin.path),bytes,pin.mode);}
  const encoded=readPinned(path.join(packet,'SOURCE-CAPSULE.json.gz.base64'),seal.files['SOURCE-CAPSULE.json.gz.base64'],2097152);
  const compressed=Buffer.from(encoded.toString().trim(),'base64');if(compressed.length!==seal.capsule.compressedBytes||hash(compressed)!==seal.capsule.compressedSha256)throw Error('CAPSULE_COMPRESSED');
  const decoded=gunzipSync(compressed,{maxOutputLength:8388608});if(decoded.length!==seal.capsule.decodedBytes||hash(decoded)!==seal.capsule.decodedSha256)throw Error('CAPSULE_DECODED');
  const capsule=JSON.parse(decoded),sourceManifest=JSON.parse(readPinned(path.join(packet,'SOURCE-MEMBERS.json'),seal.files['SOURCE-MEMBERS.json']));
  if(capsule.rows.length!==305||capsule.composition!==seal.composition)throw Error('SOURCE_COMPOSITION');
  const sourceApp=path.join(work,'source-app'),seen=new Set();
  for(const row of capsule.rows){const pin=sourceManifest.rows.find(value=>value.path===row.path);if(!pin||seen.has(row.path)||row.path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('SOURCE_PATH');const bytes=Buffer.from(row.base64,'base64');if(bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('SOURCE_MEMBER');write(path.join(sourceApp,row.path),bytes,0o644);seen.add(row.path);}
  const installTypes=app=>{for(const tool of tools.packages.filter(value=>value.name!=='typescript'))for(const pin of tool.rows)write(path.join(app,'node_modules',tool.name,pin.path),readPinned(path.join(work,'tools',tool.name,pin.path),pin),pin.mode);};
  installTypes(sourceApp);check();
  const compiler=path.join(work,'tools/typescript/bin/tsc');
  const build=await runDirect({id:'build',node:tools.node,args:[compiler,'-p',path.join(sourceApp,'tsconfig.build.json')],cwd:sourceApp,env:env(),capture:path.join(work,'capture/build'),timeoutMs:120000,bodyDeadline,finalDeadline},ledger);record('build',build.row);if(!build.row.qualified||build.row.status!==0)throw Error('BUILD_UNQUALIFIED');
  const shipping=path.join(work,'shipping');for(const pin of inventory(path.join(sourceApp,'dist')).rows)write(path.join(shipping,'dist',pin.path),readPinned(path.join(sourceApp,'dist',pin.path),pin),pin.mode);
  for(const name of ['package.json','README.md'])write(path.join(shipping,name),readPinned(path.join(sourceApp,name),sourceManifest.rows.find(row=>row.path===name)),0o644);
  const members=inventory(shipping).rows;if(members.length!==1002)throw Error('SHIPPING_CARDINALITY');result.shipping=members;record('shipping',members);
  const packed=pack(shipping,members),archive=path.join(work,'virtual-bash-b35.tgz');write(archive,packed.compressed);
  const authority={bytes:packed.compressed.length,sha256:hash(packed.compressed),decodedLimit:33554432};
  const admissionLedger={current:0,peak:0,maximum:67108864},events=[];let sameBuffer;
  const admitted=await admitPackage(archive,authority,admissionLedger,{events,decode:gunzipSync,parse(buffer){sameBuffer=buffer;return validateTar(buffer,members);}});
  result.archive={...authority,events,admitted,admissionLedger,format:'deterministic regular-file ustar/gzip author pack, not npm pack'};record('archive',result.archive);
  const installedApp=path.join(work,'installed-app'),movedApp=path.join(work,'moved-app');extract(sameBuffer,path.join(installedApp,'node_modules/virtual-bash'));write(path.join(installedApp,'package.json'),Buffer.from('{"type":"module","private":true}\n'));
  const cases=JSON.parse(readPinned(path.join(packet,'CASES-v2.json'),seal.files['CASES-v2.json']));
  const compilerApi=(await import(pathToFileURL(path.join(work,'tools/typescript/lib/typescript.js')))).default;
  const edgesFor=(filename,text)=>{const source=compilerApi.createSourceFile(filename,text,compilerApi.ScriptTarget.Latest,true,compilerApi.ScriptKind.JS),edges=[];function visit(node){if((compilerApi.isImportDeclaration(node)||compilerApi.isExportDeclaration(node))&&node.moduleSpecifier&&compilerApi.isStringLiteral(node.moduleSpecifier))edges.push(node.moduleSpecifier.text);if(compilerApi.isCallExpression(node)&&node.expression.kind===compilerApi.SyntaxKind.ImportKeyword&&node.arguments[0]&&compilerApi.isStringLiteral(node.arguments[0]))edges.push(node.arguments[0].text);compilerApi.forEachChild(node,visit);}visit(source);return [...new Set(edges)];};
  const helperNames=['guard.mjs','auth.mjs','profile.mjs','case-driver.mjs','case-adapter.mjs'];
  const prepareApp=(app,packageRoot)=>{for(const name of helperNames)if(!fs.existsSync(path.join(app,name)))write(path.join(app,name),readPinned(path.join(packet,name),seal.files[name]));if(!fs.existsSync(path.join(app,'CASES.json')))write(path.join(app,'CASES.json'),readPinned(path.join(packet,'CASES-v2.json'),seal.files['CASES-v2.json']));const files={},edges={};for(const pin of inventory(packageRoot).rows.filter(row=>row.path.startsWith('dist/')&&row.path.endsWith('.js'))){const filename=path.join(packageRoot,pin.path),bytes=readPinned(filename,pin);files[filename]=pin;edges[filename]=edgesFor(filename,bytes.toString());}for(const name of helperNames){const filename=path.join(app,name),pin=seal.files[name];files[filename]=pin;edges[filename]=edgesFor(filename,readPinned(filename,pin).toString());}files[path.join(app,'CASES.json')]=seal.files['CASES-v2.json'];const entry=path.join(app,'case-driver.mjs'),productEntry=path.join(packageRoot,'dist/index.js');edges[entry].push('virtual-bash',pathToFileURL(productEntry).href);return {files,edges,entry,productEntry};};
  const launch=async(layout,app,packageRoot,test,kind='case',expectedRefusal)=>{
   check();const id=kind+'-'+layout+'-'+test.id,trace=path.join(work,'capture',id+'.trace'),rolePath=path.join(work,'capture',id+'.role.json');write(trace,Buffer.alloc(0));const prepared=prepareApp(app,packageRoot);
   if(expectedRefusal==='AUTH_HASH')prepared.files[prepared.productEntry]={...prepared.files[prepared.productEntry],sha256:'0'.repeat(64)};
   if(expectedRefusal==='EDGE_REFUSED')prepared.edges[prepared.entry]=prepared.edges[prepared.entry].filter(value=>value!=='virtual-bash'&&value!==pathToFileURL(prepared.productEntry).href);
   const role={profile:PROFILE,kind:'product-case',id,caseId:test.id,layout,app,entry:prepared.entry,guard:path.join(app,'guard.mjs'),trace,rolePath,readFiles:[rolePath,trace],files:prepared.files,edges:prepared.edges,builtins:seal.builtins,childProcessPermission:0,workerPermission:0,loaderThreads:0,loaderMode:'synchronous-registerHooks',nodePath:tools.node.path,cases:path.join(app,'CASES.json'),productEntry:prepared.productEntry};
   validateCanonicalRole(work,role,env());const roleBytes=Buffer.from(JSON.stringify(role)+'\n');if(ledger.captureBytes+roleBytes.length>ledger.captureMaximum)throw Error('ROLE_CAPTURE_LIMIT');ledger.captureBytes+=roleBytes.length;write(rolePath,roleBytes);const args=caseArguments(role),childEnv={...env(),SURFACE_ROLE:rolePath,SURFACE_ROLE_BYTES:String(roleBytes.length),SURFACE_ROLE_SHA256:hash(roleBytes)};
   const child=await runDirect({id,node:tools.node,args,cwd:app,env:childEnv,capture:path.join(work,'capture',id),timeoutMs:30000,bodyDeadline,finalDeadline},ledger);record(id+'-lifecycle',child.row);
   if(!child.row.qualified)throw Error('CASE_LIFECYCLE');
   const traceStat=fs.lstatSync(trace);if(!traceStat.isFile()||traceStat.size>524288)throw Error('TRACE_BOUND');const traceBytes=fs.readFileSync(trace);ledger.captureBytes+=traceBytes.length;if(ledger.captureBytes>ledger.captureMaximum)throw Error('CAPTURE_AGGREGATE');const traceRows=traceBytes.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
   if(traceRows.filter(row=>row.event==='permission-admitted').length!==1||traceRows.filter(row=>row.event==='synchronous-hooks-installed').length!==1)throw Error('DENIAL_RECEIPT');
   const out=child.row.captures.find(row=>row.kind==='stdout'),err=child.row.captures.find(row=>row.kind==='stderr');
   if(expectedRefusal){const refused=child.row.status!==0&&out.bytes===0&&Buffer.from(err.base64,'base64').toString().includes(expectedRefusal);const receipt={id,expectedRefusal,refused,lifecycle:child.row,traceSha256:hash(traceBytes)};record(id,receipt);result.refusals.push(receipt);if(!refused)throw Error('BINDING_NEGATIVE_FAILED');return;}
   if(child.row.status!==0)throw Error('DRIVER_FAILURE');const receipt=JSON.parse(Buffer.from(out.base64,'base64'));if(!completion(receipt,child.row)||receipt.caseId!==test.id||receipt.layout!==layout)throw Error('PUBLIC_SETTLEMENT');const recordValue={id,rolePin:{bytes:roleBytes.length,sha256:hash(roleBytes)},receipt,trace:{bytes:traceBytes.length,sha256:hash(traceBytes),rows:traceRows}};record(id,recordValue);return recordValue;
  };
  for(const layout of ['source-built','installed','physically-moved']){
   check();const app=layout==='source-built'?sourceApp:layout==='installed'?installedApp:movedApp;
   if(layout==='physically-moved'){fs.renameSync(installedApp,movedApp);if(fs.existsSync(installedApp))throw Error('MOVE_SOURCE_REMAINS');}
   const packageRoot=layout==='source-built'?sourceApp:path.join(app,'node_modules/virtual-bash');
   if(layout==='installed')installTypes(app);
   if(!fs.existsSync(path.join(app,'consumer.mts')))write(path.join(app,'consumer.mts'),readPinned(path.join(packet,'consumer.mts.data'),seal.files['consumer.mts.data']));
   const typed=await runDirect({id:'types-'+layout,node:tools.node,args:[compiler,'--noEmit','--strict','--noUncheckedIndexedAccess','--exactOptionalPropertyTypes','--target','ES2023','--module','NodeNext','--moduleResolution','NodeNext',path.join(app,'consumer.mts')],cwd:app,env:env(),capture:path.join(work,'capture/types-'+layout),timeoutMs:120000,bodyDeadline,finalDeadline},ledger);result.types.push({layout,lifecycle:typed.row});record('types-'+layout,typed.row);if(!typed.row.qualified||typed.row.status!==0)throw Error('TYPECHECK_FAILURE');
   for(const test of cases.rows)result.observations.push(await launch(layout,app,packageRoot,test));
  }
  const mutations=[{id:'M01',caseId:'K01',from:'this.is("function")',to:'false'},{id:'M02',caseId:'K03',from:'if (this.is("("))',to:'if (true)'},{id:'M03',caseId:'K12',from:'!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(this.current.value)',to:'false'}];
  for(const mutation of mutations){const app=path.join(work,'mutant-'+mutation.id),packageRoot=path.join(app,'node_modules/virtual-bash');extract(sameBuffer,packageRoot);write(path.join(app,'package.json'),Buffer.from('{"type":"module","private":true}\n'));const parser=path.join(packageRoot,'dist/shell/parser.js'),original=fs.readFileSync(parser,'utf8'),start=original.indexOf('else if (this.is("function"))'),end=original.indexOf('else if (this.current.kind === "word"',start+1);if(start<0||end<0)throw Error('MUTANT_WINDOW');const block=original.slice(start,end);if(block.split(mutation.from).length!==2)throw Error('MUTANT_NEEDLE');const changed=original.slice(0,start)+block.replace(mutation.from,mutation.to)+original.slice(end);fs.writeFileSync(parser,changed);const receipt=await launch('installed',app,packageRoot,cases.rows.find(row=>row.id===mutation.caseId),mutation.id);const detected=!receipt.receipt.pass;result.mutants.push({mutation,before:hash(Buffer.from(original)),after:hash(Buffer.from(changed)),detected,receipt});if(!detected)throw Error('MUTANT_SURVIVED');}
  const refusalApp=movedApp,refusalRoot=path.join(movedApp,'node_modules/virtual-bash');await launch('physically-moved',refusalApp,refusalRoot,cases.rows[0],'N01','AUTH_HASH');await launch('physically-moved',refusalApp,refusalRoot,cases.rows[0],'N02','EDGE_REFUSED');
 }catch(reason){primary.fail(reason);}
 const finalState=finalize({primaryPresent:primary.present,primary:primary.reason,census:()=>sample(work,536870912),publish(state){
  result.finalSample=state.sampledWork;result.finalSamplePresent=state.sampledWorkPresent;result.ledger=ledger;result.primaryPresent=state.primaryPresent;result.primary=state.primaryPresent?errorRecord(state.primary):undefined;result.secondary=[...primary.secondary,...state.secondary.map(row=>({phase:row.phase,present:row.present,reason:errorRecord(row.reason)}))];result.finished=Date.now();result.semanticPass=result.observations.filter(row=>row.receipt.pass).length;result.semanticFail=result.observations.filter(row=>!row.receipt.pass).length;result.status=state.primaryPresent?'STOP':result.semanticFail?'COMPLETED_WITH_ASSERTION_FAILURES':'COMPLETED';record('RESULT',result);
 }});
 return {result,finalState};
}
