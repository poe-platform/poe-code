import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {admitPackage} from './package-admission.mjs';
import {validateTar} from './parse-manifest.mjs';
import {authenticated as exactRead,Storage,runChild,observeGroup,retainPrimary,digest} from './mechanism.mjs';
const directory=path.dirname(new URL(import.meta.url).pathname),work=process.argv[2];
if(!work||!path.isAbsolute(work))throw Error('CONTROL_WORK');
const seal=JSON.parse(syncFs.readFileSync(path.join(directory,'CONTROL-SEAL.json')));
for(const [name,pin] of Object.entries(seal.files))exactRead(path.join(directory,name),pin,4194304);
const authenticated=async name=>exactRead(path.join(directory,name),seal.files[name]);
await fs.mkdir(work,{mode:0o700});
const results = [];
const baseline = Buffer.from('0123456789abcdef');
const tinyAuthority = { bytes: baseline.length, sha256: digest(baseline), decodedLimit: 32 };
const specs = [
  ['C01', 'tampered', 'HASH'], ['C02', 'short', 'SIZE'], ['C03', 'oversized', 'SIZE'],
  ['C04', 'wronghash', 'HASH'], ['C05', 'directory', 'TYPE'], ['C06', 'symlink', 'TYPE'],
  ['C07', 'replacepath', 'MUTATION'], ['C08', 'mutatesource', ['MUTATION', 'HASH']],
  ['C09', 'truncateafterread', 'MUTATION'], ['C10', 'aggregate', 'AGGREGATE'],
  ['C11', 'orderingmutant', 'HASH'], ['C12', 'restored', 'HASH'],
];
for (const [id, kind, expectedCode] of specs) {
  const filename = path.join(work, id);
  const counts = { decoder: 0, parser: 0, extraction: 0 };
  const events = [];
  const ledger = { current: 0, peak: 0, maximum: kind === 'aggregate' ? 40 : 4096 };
  const selected = { ...tinyAuthority };
  let operation = admitPackage;
  const options = {
    events, parseReserve: 16,
    decode(bytes) { counts.decoder++; return bytes; },
    parse(bytes) { counts.parser++; return bytes.length; },
  };
  let primaryPresent = false;
  let reason;
  try {
    if (kind === 'directory') await fs.mkdir(filename);
    else if (kind === 'symlink') { await fs.writeFile(filename + '.target', baseline, { flag: 'wx' }); await fs.symlink(filename + '.target', filename); }
    else await fs.writeFile(filename, kind === 'short' ? baseline.subarray(1) : kind === 'oversized' ? Buffer.concat([baseline, Buffer.from('x')]) : kind === 'tampered' ? Buffer.from('x123456789abcdef') : baseline, { flag: 'wx' });
    if (['wronghash', 'orderingmutant', 'restored'].includes(kind)) selected.sha256 = '0'.repeat(64);
    if (kind === 'replacepath') options.afterOpen = async () => { await fs.rename(filename, filename + '.original'); await fs.writeFile(filename, baseline, { flag: 'wx' }); };
    if (kind === 'mutatesource') options.afterOpen = async () => { await fs.writeFile(filename, Buffer.from('x123456789abcdef')); };
    if (kind === 'truncateafterread') options.afterRead = async () => { await fs.truncate(filename, 1); };
    if (kind === 'orderingmutant' || kind === 'restored') {
      const moduleName = kind === 'orderingmutant' ? 'ordering-mutant.mjs' : 'restored-admission.mjs';
      await authenticated(moduleName);
      operation = (await import(pathToFileURL(path.join(directory, moduleName)))).admitPackage;
    }
    try { await operation(filename, selected, ledger, options); }
    catch (caught) { primaryPresent = true; reason = caught; }
    assert.equal(primaryPresent, true);
    assert.ok([expectedCode].flat().includes(reason?.code), `${id}: ${reason?.stack}`);
    assert.equal(counts.decoder, kind === 'orderingmutant' ? 1 : 0);
    assert.equal(counts.parser, 0);
    assert.equal(counts.extraction, 0);
    assert.equal(ledger.current, 0);
    results.push({ id, kind, status: 'PASS', reasonCode: reason.code, counts, events, ledger, primaryPresent });
  } catch (caught) {
    results.push({ id, kind, status: 'FAIL', reason: String(caught?.stack ?? caught), counts, events, ledger, primaryPresent });
  } finally {
    for (const suffix of ['', '.original', '.target']) await fs.rm(filename + suffix, { recursive: true, force: true });
  }
  console.log(JSON.stringify(results.at(-1)));
}

const extra=[];const add=async(id,operation)=>{try{const evidence=await operation();extra.push({id,status:'PASS',evidence});}catch(reason){extra.push({id,status:'FAIL',reason:reason instanceof Error?reason.stack:typeof reason});}console.log(JSON.stringify(extra.at(-1)));};
await add('M01',async()=>{const filename=path.join(work,'same-buffer');await fs.writeFile(filename,baseline,{flag:'wx'});let decoderBuffer,parserBuffer;const ledger={current:0,peak:0,maximum:4096},events=[];await admitPackage(filename,tinyAuthority,ledger,{events,parseReserve:16,decode(bytes){decoderBuffer=bytes;syncFs.writeFileSync(filename,Buffer.from('changed-after-auth'));assert.deepEqual(bytes,baseline);return bytes;},parse(bytes){parserBuffer=bytes;return 16;}});assert.equal(decoderBuffer,parserBuffer);assert.equal(events.filter(value=>value==='bounded-read').length,1);await fs.unlink(filename);return {sameBuffer:true,events};});
await add('M02',async()=>{const encoded=await authenticated('SYNTHETIC-TAR.base64');const bytes=Buffer.from(encoded.toString().trim(),'base64');const expected=JSON.parse(await authenticated('SYNTHETIC-MEMBERS.json'));return validateTar(bytes,expected);});
const tools=JSON.parse(await authenticated('TOOLS.json'));const ledger={maximum:7,peak:1,active:0,starts:0,captureBytes:0,captureMaximum:16777216,observedPeak:0,rows:[],stopped:false};let loaderRequests=0;
const node=tools.node.path;const fixtures=path.join(directory,'fixtures');const env={PATH:work,HOME:work,TMPDIR:work,LC_ALL:'C',LANG:'C',TZ:'UTC'};
for(const [id,kind] of [['M03','loaded'],['M04','wronghash'],['M05','unlisted'],['M06','worker'],['M07','normal'],['M08','term'],['M09','kill']]){
 await add(id,async()=>{if(ledger.stopped)throw Error('CONTROL_ADMISSION_STOP');let args,extraEnv={};
 if(['loaded','wronghash','unlisted','worker'].includes(kind)){
  loaderRequests++;const filename=path.join(fixtures,kind==='unlisted'?'unlisted-entry.mjs':kind==='worker'?'worker-refusal.mjs':'loaded.mjs');const filePins={};for(const name of ['fixtures/loaded.mjs','fixtures/unlisted-entry.mjs','fixtures/worker-refusal.mjs'])filePins[path.join(directory,name)]=seal.files[name];if(kind==='wronghash')filePins[filename]={...filePins[filename],sha256:'0'.repeat(64)};
  const mainTrace=path.join(work,id+'.main'),loaderTrace=path.join(work,id+'.loader');await fs.writeFile(mainTrace,'',{flag:'wx'});await fs.writeFile(loaderTrace,'',{flag:'wx'});const policy={id,regexWorkerPermission:0,files:filePins,builtins:['node:worker_threads','node:crypto'],mainTrace,loaderTrace,loader:path.join(directory,'loader.mjs')};const role=Buffer.from(JSON.stringify(policy)+'\n'),rolePath=path.join(work,id+'.role');await fs.writeFile(rolePath,role,{flag:'wx'});extraEnv={SURFACE_ROLE:rolePath,SURFACE_ROLE_SHA256:digest(role)};args=['--import',path.join(directory,'guard.mjs'),filename];
 }else args=[path.join(fixtures,kind+'.mjs')];
 const result=await runChild({label:id,executable:node,args,cwd:work,env:{...env,...extraEnv},capture:path.join(work,id),timeoutMs:['term','kill'].includes(kind)?800:4000,bodyDeadline:Date.now()+8000,finalDeadline:Date.now()+10000,streamLimit:65536,allowTimeout:['term','kill'].includes(kind)},ledger);
 if(ledger.stopped)throw Error('SAFETY_STOP');assert.equal(result.row.group.state,'absent');assert.equal(result.row.close,true);assert.equal(result.row.stdoutEOF,true);assert.equal(result.row.stderrEOF,true);
 const stdout=Buffer.from(result.row.captures.find(value=>value.name==='stdout').base64,'base64').toString(),stderr=Buffer.from(result.row.captures.find(value=>value.name==='stderr').base64,'base64').toString();
 if(kind==='wronghash'){assert.equal(result.row.status,1);assert.match(stderr,/LOAD_HASH_REFUSED/);assert.equal(stdout,'');}
 else if(kind==='unlisted'){assert.equal(result.row.status,1);assert.match(stderr,/LOAD_BINDING_REFUSED/);assert.equal(stdout,'');}
 else if(kind==='worker'){assert.equal(result.row.status,0);assert.equal(stdout,'REGEX_WORKER_REFUSED\n');}
 else if(kind==='loaded'){assert.equal(result.row.status,0);assert.equal(stdout,'LOADER_READY\n');}
 else if(kind==='normal'){assert.equal(result.row.status,0);assert.equal(stdout,'READY\n');}
 else{assert.equal(result.row.fixtureTimeoutQualified,true);assert.equal(result.row.signals[0].signal,'SIGTERM');if(kind==='kill'){assert.equal(result.row.signal,'SIGKILL');assert.equal(result.row.signals[1].signal,'SIGKILL');assert.ok(result.row.signals[1].at-result.row.signals[0].at>=1900);}else assert.equal(result.row.status,0);}
 return {row:result.row,loader:extraEnv.SURFACE_ROLE?{main:await fs.readFile(path.join(work,id+'.main'),'utf8'),loader:await fs.readFile(path.join(work,id+'.loader'),'utf8')}:undefined};});
 if(ledger.stopped){console.log(JSON.stringify({event:'SAFETY_STOP',ledger}));process.exitCode=1;break;}
}
function fakeStorage(fault,clock=()=>0){const calls=[];const expected=Error(fault);let size=0;const operations={openSync(){calls.push('open');return 1;},writeFileSync(fd,bytes){calls.push('write');size=bytes.length;},fsyncSync(){calls.push('fsync');if(fault==='fsync')throw expected;},fstatSync(){calls.push('stat');return {size};},closeSync(){calls.push('close');if(fault==='close')throw expected;}};return {storage:new Storage(work,{bodyDeadline:10,finalDeadline:20,maximum:4096},clock,operations),calls,expected};}
if(!ledger.stopped){
 for(const [id,kind] of [['M10','fsync'],['M11','close']])await add(id,async()=>{const fixture=fakeStorage(kind);assert.throws(()=>fixture.storage.terminal('result',{}),reason=>reason===fixture.expected);assert.equal(fixture.storage.completed,0);assert.equal(fixture.calls.filter(value=>value==='close').length,1);return fixture.calls;});
 await add('M12',async()=>{const fixture=fakeStorage('none',()=>21);assert.throws(()=>fixture.storage.terminal('result',{}),/FINAL_DEADLINE/);assert.deepEqual(fixture.calls,[]);assert.equal(fixture.storage.completed,0);let tick=0;const late=fakeStorage('none',()=>++tick>=3?21:0);assert.throws(()=>late.storage.terminal('late',{}),/FINAL_DEADLINE/);assert.equal(late.storage.completed,0);return {expiredBeforeWrites:true,lateNoCredit:true,calls:late.calls};});
 await add('M13',async()=>{const fixture=fakeStorage('none',()=>11);assert.throws(()=>fixture.storage.file('ordinary',Buffer.from('x')),/BODY_DEADLINE/);fixture.storage.terminal('final',{});assert.equal(fixture.storage.completed,1);return fixture.calls;});
 await add('M14',async()=>{for(const reason of [false,0,undefined]){const primary={present:true,reason},selected=retainPrimary(primary,{present:true,reason:Error('cleanup')});assert.equal(selected,primary);assert.equal(Object.is(selected.reason,reason),true);}return {identities:['false','0','undefined'],preserved:3};});
 await add('M15',async()=>{const absent=observeGroup(123,()=>{throw Object.assign(Error('missing'),{code:'ESRCH'});}),unknown=observeGroup(123,()=>{throw Object.assign(Error('denied'),{code:'EPERM',errno:1,syscall:'kill'});}),present=observeGroup(123,()=>{});assert.equal(absent.state,'absent');assert.equal(unknown.state,'unknown');assert.equal(unknown.error.code,'EPERM');assert.equal(present.state,'present');return {absent,unknown,present};});
 await add('M16',async()=>{const row=ledger.rows.find(value=>value.label==='M07');assert.ok(row.events.indexOf('capture-opened')<row.events.indexOf('listeners-enrolled'));assert.ok(row.events.indexOf('listeners-enrolled')<row.events.indexOf('exit'));assert.ok(row.events.indexOf('close')<row.events.indexOf('capture-finalization'));const fixture=fakeStorage('none');fixture.storage.terminal('ordered',{});assert.deepEqual(fixture.calls,['open','write','fsync','stat','close']);return {events:row.events,publication:fixture.calls};});
}
const output={schema:'virtual-comparison-v2-controls',earlyAdmission:results,mechanisms:extra,knownFixtureStarts:ledger.starts,loaderRegistrationRequests:loaderRequests,regexWorkerStarts:0,ledger,productionArchiveReads:0,productImports:0,caseAdapterInvocations:0,nativeExecutions:0};await fs.writeFile(path.join(work,'RESULT.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({early:results.filter(row=>row.status==='PASS').length,mechanism:extra.filter(row=>row.status==='PASS').length,knownFixtureStarts:ledger.starts,loaderRequests,stopped:ledger.stopped}));if(results.some(row=>row.status!=='PASS')||extra.length!==16||extra.some(row=>row.status!=='PASS'))process.exitCode=1;
