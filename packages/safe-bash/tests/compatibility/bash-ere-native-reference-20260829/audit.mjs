import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {SourceTextModule} from 'node:vm';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(path.join(root,'audit.capture.data'),'wx',0o600);
const emit=value=>fs.writeSync(capture,JSON.stringify(value)+'\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let readBytes=0;
const read=name=>{const filename=path.join(root,name),stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&stat.size<=4194304);readBytes+=stat.size;assert.ok(readBytes<=16777216);return fs.readFileSync(filename);};
const git=(args,input)=>{
 emit({event:'start',args});const result=spawnSync('/usr/bin/git',args,{cwd:'/Users/kjopek/Workspace/safe-bash',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},input,timeout:10000,maxBuffer:1048576});emit({event:'retired',pid:result.pid,status:result.status,signal:result.signal,stdout:args[0]==='status'?result.stdout?.toString():undefined,stderr:result.stderr?.toString()});assert.equal(result.status,0);assert.equal(result.signal,null);return result.stdout;
};
try{
 emit({event:'begin',at:new Date().toISOString(),role:'SOURCE/DATA audit only'});
 git(['status','--short','--untracked-files=no']);
 const cohort=JSON.parse(read('COHORT.json'));const requests=JSON.parse(read('REQUESTS.json'));
 const ids=Array.from({length:12},(_,index)=>'N'+String(index+1).padStart(2,'0'));
 assert.deepEqual(cohort.cases.map(row=>row.id),ids);assert.deepEqual(requests.map(row=>row.id),ids);assert.deepEqual(cohort.fixtures,[]);
 assert.deepEqual(fs.readdirSync(path.join(root,'programs')).sort(),ids.map(id=>id+'.bash.data'));
 const commonAfterId=`\\000%s\\000%s\\000' "$match_status" "$rematch_count"\nif (( rematch_count > 4 )); then\n  builtin printf 'CARDINALITY_OVERFLOW\\000'\n  exit 125\nfi\nfor slot in 0 1 2 3; do\n  if [[ \${BASH_REMATCH[$slot]+present} == present ]]; then\n    builtin printf '%s\\0001\\000%s\\000' "$slot" "\${BASH_REMATCH[$slot]}"\n  else\n    builtin printf '%s\\0000\\000\\000' "$slot"\n  fi\ndone\nexit "$match_status"\n`;
 const audits=[];
 for(const row of cohort.cases){
  assert.ok(!row.pattern.includes("'")&&!row.subject.includes("'")&&!row.pattern.includes('\n')&&!row.subject.includes('\n'));
  const bytes=read('programs/'+row.id+'.bash.data');assert.equal(sha(bytes),row.programSha256);assert.equal(bytes.length,row.programBytes);assert.ok([...bytes].every(value=>value>0&&value<128));
  const prefix=`pattern='${row.pattern}'\nsubject='${row.subject}'\n[[ "$subject" =~ $pattern ]]\nmatch_status=$?\nrematch_count=\${#BASH_REMATCH[@]}\nbuiltin printf 'EREOBS1\\000${row.id}`;
  assert.equal(bytes.toString(),prefix+commonAfterId);assert.equal(row.program,bytes.toString());assert.equal(row.expectedNative,null);assert.equal(row.observation,'UNRUN');
  const request=requests.find(item=>item.id===row.id);assert.deepEqual(request.argv,['--noprofile','--norc','-c',row.program,'ere-capture-case']);assert.equal(request.executable,'/bin/bash');assert.equal(request.stdinBase64,'');assert.equal(request.extraProcessReservation,0);
  assert.deepEqual(Object.keys(request.environment),['LC_ALL','LANG','TZ','HOME','TMPDIR','PATH']);assert.equal(request.environment.LC_ALL,'C');assert.equal(request.environment.LANG,'C');assert.equal(request.environment.TZ,'UTC');
  const caseRoot='/private/tmp/safe-bash-ere-native-observations-20260829-v1/cases/'+row.id;assert.equal(request.cwd,caseRoot+'/work');assert.equal(request.environment.HOME,caseRoot+'/home');assert.equal(request.environment.TMPDIR,caseRoot+'/tmp');assert.equal(request.environment.PATH,caseRoot+'/empty-path');
  audits.push({id:row.id,bytes:bytes.length,sha256:sha(bytes),completeBodyInspected:true,loopIterations:4,externalCommands:[],filesystemOperations:[],stdinBytes:0,sourceForkReservations:0,native:'UNRUN'});
 }
 const delta=JSON.parse(read('SOURCE-DELTA.json'));const parent=JSON.parse(read('v3-evidence/PRESEAL.json.data'));const sourceManifest=JSON.parse(read('v3-source/MANIFEST.json'));
 const imports=[];
 for(const row of delta.moduleBindings){
  const bytes=read(row.path);assert.equal(sha(bytes),row.sha256);assert.equal(bytes.length,row.bytes);
  if(row.parentSha256){
   const before=read('v3-source/'+row.runtimePath+'.data');assert.equal(sha(before),row.parentSha256);assert.equal(parent.files.find(item=>item.path===row.runtimePath).sha256,row.parentSha256);assert.equal(sourceManifest.rows.find(item=>item.capture===row.runtimePath+'.data').sha256,row.parentSha256);
   let derived=before.toString();for(const change of delta.changes.filter(item=>item.file===row.runtimePath)){assert.equal(derived.split(change.before).length-1,change.occurrences??1);derived=derived.replaceAll(change.before,change.after);}assert.equal(derived,bytes.toString());
  }
  const parsed=new SourceTextModule(bytes.toString(),{identifier:row.runtimePath});assert.equal(parsed.status,'unlinked');
  for(const dependency of parsed.dependencySpecifiers)assert.ok(['node:fs','node:path','node:crypto','node:process','node:url','node:child_process'].includes(dependency)||delta.moduleBindings.some(item=>'./'+item.runtimePath===dependency),'dependency '+dependency);
  imports.push({module:row.runtimePath,dependencies:parsed.dependencySpecifiers,role:'parsed only, not linked/evaluated'});
 }
 const version=JSON.parse(read('VERSION-PROVENANCE.json'));
 const inventory=git(['ls-tree','-r','-z',version.commit,'--',...version.files.map(row=>row.path)]);
 const originals=inventory.toString().split('\0').filter(Boolean).map(text=>{const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(text);assert.ok(match);return{mode:match[1],blob:match[2],path:match[3]};});assert.equal(originals.length,5);
 const batch=git(['cat-file','--batch'],originals.map(row=>row.blob).join('\n')+'\n');let cursor=0;
 fs.mkdirSync(path.join(root,'version-history'));
 for(const row of originals){const newline=batch.indexOf(10,cursor);const [blob,type,length]=batch.subarray(cursor,newline).toString().split(' '),size=Number(length);assert.equal(blob,row.blob);assert.equal(type,'blob');assert.ok(Number.isSafeInteger(size)&&size>=0&&size<65536);const bytes=batch.subarray(newline+1,newline+1+size);assert.equal(batch[newline+size+1],10);assert.equal(crypto.createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex'),blob);const expected=version.files.find(item=>item.path===row.path);assert.equal(size,expected.bytes);assert.equal(sha(bytes),expected.sha256);row.bytes=size;row.sha256=sha(bytes);row.capture=path.basename(row.path)+'.data';fs.writeFileSync(path.join(root,'version-history',row.capture),bytes,{flag:'wx',mode:0o600});cursor=newline+size+2;}
 assert.equal(cursor,batch.length);
 const approval=JSON.parse(read('APPROVAL-PROPOSAL.template.json'));assert.equal(approval.parameters.sandbox_permissions,'require_escalated');assert.equal(approval.parameters.login,false);assert.equal(approval.parameters.shell,'/bin/zsh');assert.ok(!('prefix_rule' in approval.parameters));assert.equal(approval.parameters.cmd.split('ROOT_APPROVED_GRANT_SHA256').length,2);
 assert.ok(!fs.existsSync(path.join(root,'materialized')));assert.ok(!fs.existsSync(path.join(root,'GO.json')));
 const result={at:new Date().toISOString(),status:'SOURCE_DATA_PREPARATION_ONLY',programs:audits,fixtureInventory:[],imports,versionHistory:{commit:version.commit,files:originals,newExecutions:0},initialGeneratorPredicate:'NOT relied on; exact full-body checks used',preexecControls:{proposed:12,executed:0},nativeObservations:{planned:12,executed:0},entryImports:0,namespaceMaterialized:false,approvalRequested:false,authority:'new independent review and fresh ROOT activation required',readBytes};
 fs.writeFileSync(path.join(root,'AUDIT-RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 const sealed=[];for(const name of ['HANDOFF.md','PREPARATION.md','prepare.mjs','audit.mjs','COHORT.json','REQUESTS.json','PROTOCOL.json','TOOLS.json','VERSION-PROVENANCE.json','SOURCE-DELTA.json','PREEXEC-CONTROLS-PROPOSAL.json','APPROVAL-PROPOSAL.template.json','AUDIT-RESULT.json',...ids.map(id=>'programs/'+id+'.bash.data'),...delta.moduleBindings.map(row=>row.path)]){const bytes=read(name);sealed.push({path:name,bytes:bytes.length,mode:fs.lstatSync(path.join(root,name)).mode&511,sha256:sha(bytes)});}
 const seal={schema:'ere-reference-preparation-seal-v1',role:'SOURCE/DATA; NOT runtime PRESEAL and NOT GO',createdAt:new Date().toISOString(),files:sealed,parentSource:delta.parentSource,parentPresealSha256:delta.parentPresealSha256,native:'UNRUN',controls:'PROPOSED_UNRUN'};
 fs.writeFileSync(path.join(root,'PACKET-SEAL.json'),JSON.stringify(seal,null,2)+'\n',{flag:'wx',mode:0o600});emit({event:'complete',programs:12,draftModules:imports.length,versionFiles:5,readBytes,packetSha256:sha(fs.readFileSync(path.join(root,'PACKET-SEAL.json')))});console.log(JSON.stringify({packetSha256:sha(fs.readFileSync(path.join(root,'PACKET-SEAL.json'))),programs:audits,imports,versionFiles:originals.length}));
}catch(error){emit({event:'failure',message:String(error?.stack??error)});process.exitCode=1;}
finally{fs.fsyncSync(capture);fs.closeSync(capture);}
