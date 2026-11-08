import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { SourceTextModule } from 'node:vm';
const root=path.dirname(new URL(import.meta.url).pathname);
const log=fs.openSync(path.join(root,'preparation.capture.data'),'wx',0o600);
const emit=value=>fs.writeSync(log,JSON.stringify(value)+'\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const runRoot='/private/tmp/safe-bash-ere-native-observations-20260829-v1';
const profile='ere-capture-reference-v1';
const activeDirectory=root+'/materialized';
let outputBytes=0;
const outputs=[];
const write=(name,value)=>{
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
  outputBytes+=bytes.length;assert.ok(outputBytes<=8388608&&outputs.length<100);
  const location=path.join(root,name);fs.mkdirSync(path.dirname(location),{recursive:true});fs.writeFileSync(location,bytes,{flag:'wx',mode:0o600});
  outputs.push({path:name,bytes:bytes.length,mode:384,sha256:sha(bytes)});return outputs.at(-1);
};
const source=(role,name)=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,role,'MANIFEST.json')));
  const row=manifest.rows.find(row=>row.capture===name+'.data');assert.ok(row);
  const location=path.join(root,role,row.capture);const stat=fs.lstatSync(location);assert.ok(stat.isFile()&&stat.size===row.bytes&&stat.size<=4194304);
  const body=fs.readFileSync(location);assert.equal(sha(body),row.sha256);return body.toString('utf8');
};
const pin=record=>{
  assert.equal(fs.realpathSync(record.path),record.path);
  const handle=fs.openSync(record.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(handle);assert.ok(before.isFile()&&before.size<=134217728);assert.equal(before.size,record.bytes);assert.equal(before.mode&511,record.mode);
    const hash=crypto.createHash('sha256');const buffer=Buffer.alloc(65536);let total=0,count;
    while((count=fs.readSync(handle,buffer,0,buffer.length,null))>0){total+=count;assert.ok(total<=before.size);hash.update(buffer.subarray(0,count));}
    assert.equal(total,record.bytes);assert.equal(hash.digest('hex'),record.sha256);
    const after=fs.fstatSync(handle);assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.size,before.size);
    return{...record,observedAt:new Date().toISOString(),operation:'metadata/stream-hash only'};
  }finally{fs.closeSync(handle);}
};
try{
  emit({event:'start',at:new Date().toISOString(),role:'SOURCE/DATA preparation'});
  const inheritedSeal=source('v3-evidence','PRESEAL.json');assert.equal(sha(inheritedSeal),'ffee6eafb226ead4f9a15351c2964693971dfff7004b0d96cd6f9d0ca6098533');
  const tools=JSON.parse(source('v3-source','TOOLS.json'));
  const wrapper=JSON.parse(source('v3-source','WRAPPER-TOOL.json'));
  const freshPins=[...tools.toolPins,tools.environmentLauncher,wrapper].map(pin);
  write('TOOLS.json',{schema:'ere-reference-tools-v1',toolPins:tools.toolPins,environmentLauncher:tools.environmentLauncher,wrapperTool:wrapper,freshPins,bashLoadCommands:tools.bashLoadCommands,qualifiedRuntimeLoaderGraph:false,currentDyldCacheRehash:false,source:'frozen functional-v3 metadata; fresh executable stream hashes; no version execution'});
  write('VERSION-PROVENANCE.json',JSON.parse(source('v3-source','VERSION-PROVENANCE.json')));
  try{fs.lstatSync(runRoot);throw Error('proposed run root already exists; no reuse');}catch(error){if(error.code!=='ENOENT')throw error;}
  const definitions=[
    ['N01','(a(b)?)+','aba',['I01-parent-optional-reset','author-E12'],'optional child omitted in final parent'],
    ['N02','((a)|(b))+','ab',['I02-parent-alternative-reset'],'final alternative differs'],
    ['N03','((a(b)?)c)+','abcac',['I03-nested-parent-reset'],'nested grandchild omission'],
    ['N04','(ba(na)*s )*','bananas bas ',['I04-manual-example'],'GNU manual reporting example'],
    ['N05','(a(b)?){2}','aba',['I05-finite-parent-reset'],'fixed parent repetition'],
    ['N06','((a)?b){2}','abb',['I06-parent-zero-iteration'],'optional inner zero iteration'],
    ['N07','((a)|(b))+','ba',['I23-finite-reset-property'],'one finite reverse-alternative witness, NOT all62 property inputs'],
    ['N08','(a(b)?)+','ab',[],'final inner participation control'],
    ['N09','(a)?b','b',[],'optional omission shell-visible reporting control'],
    ['N10','(a*)b','b',[],'empty captured string reporting control'],
    ['N11','(a)','b',[],'nonmatch observation control'],
    ['N12','(','a',[],'invalid ERE status observation control'],
  ];
  const cases=definitions.map(([id,pattern,subject,maps,purpose])=>{
    for(const value of [pattern,subject])assert.ok([...value].every(character=>character.charCodeAt(0)>0&&character.charCodeAt(0)<128)&&!value.includes("'")&&!value.includes('\n'));
    const program=`pattern='${pattern}'\nsubject='${subject}'\n[[ "$subject" =~ $pattern ]]\nmatch_status=$?\nrematch_count=\${#BASH_REMATCH[@]}\nbuiltin printf 'EREOBS1\\000${id}\\000%s\\000%s\\000' "$match_status" "$rematch_count"\nif (( rematch_count > 4 )); then\n  builtin printf 'CARDINALITY_OVERFLOW\\000'\n  exit 125\nfi\nfor slot in 0 1 2 3; do\n  if [[ \${BASH_REMATCH[$slot]+present} == present ]]; then\n    builtin printf '%s\\0001\\000%s\\000' "$slot" "\${BASH_REMATCH[$slot]}"\n  else\n    builtin printf '%s\\0000\\000\\000' "$slot"\n  fi\ndone\nexit "$match_status"\n`;
    assert.ok(program.length<2048&&!program.includes('$(')&&!program.includes('`')&&!program.includes('<<')&&!program.includes('>') || program.includes('rematch_count > 4'));
    const binding=write('programs/'+id+'.bash.data',program);
    return{id,pattern,subject,maps,purpose,program,programSha256:binding.sha256,programBytes:binding.bytes,stdinBase64:'',expectedNative:null,observation:'UNRUN',effectProfile:'no program filesystem operations',sourceInternalForkReservation:0};
  });
  assert.equal(cases.length,12);write('COHORT.json',{schema:profile,cases,fixtures:[],fixtureInventory:{count:0,bytes:0,paths:[]},nativeExecutions:0,expectedNativeGoldens:false});
  write('REQUESTS.json',cases.map(row=>({id:row.id,executable:'/bin/bash',argv:['--noprofile','--norc','-c',row.program,'ere-capture-case'],cwd:runRoot+'/cases/'+row.id+'/work',environment:{LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:runRoot+'/cases/'+row.id+'/home',TMPDIR:runRoot+'/cases/'+row.id+'/tmp',PATH:runRoot+'/cases/'+row.id+'/empty-path'},stdinBase64:'',extraProcessReservation:0})));
  const limits={totalMs:600000,setupMs:60000,finalizationTailMs:60000,perCaseMs:3000,termMs:2000,killMs:1000,knownManagedProcessCeiling:13,knownPeakCeiling:2,allKnownProcessProposalCeiling:40,allKnownPeakProposalCeiling:3,ownerStarts:1,nativeStarts:12,administrativeChildStarts:0,sourceInternalForkReservations:0,perStreamBytes:65536,aggregateCaptureBytes:33554432,workingBytes:134217728,emergencyReserveBytes:65536,ownerWriteBytes:262144,snapshotEntries:32,snapshotFileBytes:65536,snapshotBytes:262144};
  write('PROTOCOL.json',{schema:profile,runRoot,limits,profile:'FUNCTIONAL_OBSERVATION_ONLY_NOT_CONTAINMENT',nativeGo:false,initialToolShellStartup:'TRUSTED_HOST_OUTSIDE_CHILD_FRESH_ENV_AND_RAW_CAPTURE',bashChildren:'exact six-key env, fresh empty HOME/TMPDIR/PATH, --noprofile --norc, empty closed stdin; no BASH_ENV/ENV/SHELLOPTS/BASHOPTS/functions',output:{format:'EREOBS1 NUL id NUL regexStatus NUL cardinality NUL then four [index NUL shellSlotPresent NUL rawValue NUL] records',status:'process exit equals recorded regex status; nonzero is an observation, not automatic test failure',hiddenRegexecSpans:'UNOBSERVABLE',emptyVsNativeNonparticipation:'NOT inferred from identical empty strings; shell-slot presence is not C regmatch_t participation'},publication:'inclusive final deadline before/after writes, terminal/flush/credit; cleanup attempted independently; late cleanup cannot qualify',authorization:'independent review plus fresh runtime receipt/GO and resolved-slot DATA review plus exact require_escalated tool approval; no old authority reuse'});
  const changes=[];const modules={};
  const replace=(name,before,after)=>{assert.equal(modules[name].split(before).length,2,'exact unique delta '+name+' '+before);modules[name]=modules[name].replace(before,after);changes.push({file:name,before,after});};
  for(const name of ['entry','admission','capture','lifecycle','group-observer','observer-state','state','storage'])modules[name+'.mjs']=source('v3-source',name+'.mjs');
  replace('entry.mjs',"const root='/private/tmp/safe-bash-surface-functional-v3-20260829-01';",`const root='${runRoot}';`);
  replace('entry.mjs','new ManagedLedger(80,6)','new ManagedLedger(13,2)');
  replace('entry.mjs',"import {finalizeCaptures} from './capture.mjs';","import {finalizeCaptures} from './capture.mjs';\nimport {decodeObservation} from './observation.mjs';");
  replace('entry.mjs',"directory+'/AUDIT.json'","directory+'/COHORT.json'");
  replace('entry.mjs',"row.path==='AUDIT.json'","row.path==='COHORT.json'");
  replace('entry.mjs',"audit.cases.filter(row=>!['B26','B27','B28'].includes(row.id)).map(row=>row.id)",'audit.cases.map(row=>row.id)');
  replace('entry.mjs',"expectedIds.length===37,'EXACT37'","expectedIds.length===12,'EXACT12'");
  replace('entry.mjs',"literal.program,'surface-case'","literal.program,'ere-capture-case'");
  const fixtureLine=modules['entry.mjs'].split('\n').find(line=>line.includes('for(const fixture of audit.fixtures)'));assert.ok(fixtureLine);
  replace('entry.mjs',fixtureLine,"  assert(Array.isArray(audit.fixtures)&&audit.fixtures.length===0,'NO_FIXTURES');");
  replace('entry.mjs',"assert(ledger.sourceForkReservations<=13,'SOURCE_RESERVATION_DRIFT');","assert(request.extraProcessReservation===0&&ledger.sourceForkReservations===0,'SOURCE_RESERVATION_DRIFT');");
  const snapshotLine=modules['entry.mjs'].split('\n').find(line=>line.includes('row.filesBefore=before;'));assert.ok(snapshotLine);
  replace('entry.mjs',snapshotLine,"  row.filesBefore=before;row.filesAfter=snapshot(caseRoot);assert(JSON.stringify(row.filesAfter)===JSON.stringify(before),'UNEXPECTED_EFFECT');row.filesVerified=true;row.observation=decodeObservation(row);");
  replace('entry.mjs',"schema:'functional-native-observations-v3'","schema:'ere-native-capture-observations-v1'");
  for(const [before,after] of [['functional-reference-independent-acceptance-v3','ere-capture-independent-acceptance-v1'],['functional-reference-root-grant-v3','ere-capture-root-grant-v1']])replace('admission.mjs',before,after);
  const profileCount=modules['admission.mjs'].split("'functional-reference-v3'").length-1;assert.equal(profileCount,2);
  modules['admission.mjs']=modules['admission.mjs'].replaceAll("'functional-reference-v3'",`'${profile}'`);changes.push({file:'admission.mjs',before:"'functional-reference-v3'",after:`'${profile}'`,occurrences:2});
  modules['observation.mjs']=fs.readFileSync(path.join(root,'observation.mjs.data'),'utf8');
  const moduleBindings=[];
  for(const [name,body] of Object.entries(modules)){
    const parsed=new SourceTextModule(body,{identifier:name});assert.equal(parsed.status,'unlinked');
    moduleBindings.push({...write('draft/'+name+'.data',body),runtimePath:name,role:'inert proposed runtime body; parsed only, never linked or executed',parentSha256:name==='observation.mjs'?null:sha(source('v3-source',name)),changed:changes.some(row=>row.file===name)});
  }
  write('SOURCE-DELTA.json',{parentSource:'4eea354169492b4c47d373d504e5918e1c4f3830',parentEvidence:'73065e68469e2e514c0ee87ff34ac1db04ba51cb',parentPresealSha256:sha(inheritedSeal),changes,moduleBindings,sourceMaterialization:'future explicit regular-file copies under materialized/, with fresh mode/byte/import admission; not created or authorized here'});
  const oldTemplate=JSON.parse(source('v3-evidence','APPROVAL-REQUEST.template.json'));
  const cmd=`umask 077; unsetopt MULTIOS; set -C; exec /usr/bin/env -i LC_ALL=C LANG=C TZ=UTC PATH=/usr/bin:/bin ${tools.toolPins[0].path} ${activeDirectory}/entry.mjs --grant ${activeDirectory}/GO.json --grant-sha256 ROOT_APPROVED_GRANT_SHA256 >${runRoot}/outer/bootstrap.stdout 1<>${runRoot}/outer/bootstrap.stdout 2>${runRoot}/outer/bootstrap.stderr 2<>${runRoot}/outer/bootstrap.stderr`;
  assert.equal(cmd.split('ROOT_APPROVED_GRANT_SHA256').length,2);
  write('APPROVAL-PROPOSAL.template.json',{schema:'ere-capture-tool-approval-proposal-v1',status:'SOURCE_ONLY_NO_REQUEST_NO_ACTUAL_ENTRY_NO_GO',parameters:{...oldTemplate.parameters,cmd,justification:'Allow only this fresh, independently reviewed 12-program Bash3.2.57 capture-observation cohort, with initial tool-shell startup trusted host outside child clean-env/raw capture; no containment, GNU5.3, native parity or product fallback claim?'},prefixRule:'NONE',soleLaterMutableSlot:'ROOT_APPROVED_GRANT_SHA256',requiredBeforeResolution:['materialize and authenticate exact reviewed draft bodies and assets; create fresh runtime PRESEAL without GO/receipt/template cycles','independent accepted runtime receipt pinned to new PRESEAL/REQUESTS','ROOT fresh GO pins receipt/new PRESEAL/profile/limits/exact namespace/future absolute expiry','resolve sole SHA slot; separate DATA review of exact command then require_escalated tool approval'],initialToolShellStartup:oldTemplate.startupScope,oldGrantReused:false});
  write('PREEXEC-CONTROLS-PROPOSAL.json',{status:'PROPOSED_UNRUN',cases:[
    ['C01','exact12 program membership/zero fixtures; reject added N13 or old fixture'],['C02','program SHA/argv drift, file operand or external command substitution rejected'],['C03','draft module/mode/import closure drift and wrong tool identity denied'],['C04','missing/wrong independent receipt/profile/hash denied before child'],['C05','expired GO and inclusive final deadline; no terminal/observation credit late'],['C06','one grant-SHA slot replacement only; reject other command drift or prefix rule'],['C07','outer FD mode/inode/path/regular/read-write mismatch denied'],['C08','fsync/size/hash/close failures; independent cleanup and no credit'],['C09','synthetic actual-TERM timestamp plus2s KILL and1s final group observation; old real-child derivative remains separately qualified'],['C10','exact child environment/empty PATH and no ambient startup variables; no user startup inspection'],['C11','NUL protocol roundtrip raw empty/set/unset values and status0/1/2; reject malformed framing/cardinality without expected native tuples'],['C12','before/after namespace set changes, process ledger and storage caps; refuse credit on unverified retirement']
  ].map(([id,purpose])=>({id,purpose,status:'UNRUN'})),realChildProposal:0,engineOrNativeExecutions:0});
  write('PREPARATION-RESULT.json',{status:'SOURCE_DATA_READY_FOR_DIFFERENT_REVIEW_NOT_ACTUAL_GO',nativeCases:cases.map(row=>({id:row.id,maps:row.maps,purpose:row.purpose,programSha256:row.programSha256,programBytes:row.programBytes,status:'UNRUN'})),fixtures:[],sourceModules:moduleBindings.length,syntax:'9 new/proposed JS modules parsed unlinked; no entry imports',actualControls:0,nativeExecutions:0,namespaceCreated:false,toolMetadata:freshPins,outputs:outputs.slice(),outputBytes});
  emit({event:'complete',outputBytes,files:outputs.length,cases:cases.length,modules:moduleBindings.length,actualGo:false});
  console.log(JSON.stringify({cases:cases.map(row=>({id:row.id,maps:row.maps,sha256:row.programSha256,bytes:row.programBytes})),moduleBindings,outputBytes,limits}));
}catch(error){emit({event:'failure',message:String(error?.stack??error)});process.exitCode=1;}
finally{fs.fsyncSync(log);fs.closeSync(log);}
