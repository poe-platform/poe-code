import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const own='/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1';
const work='/private/tmp/safe-bash-pipestatus-preexec';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const deadline=1788020118869;
function read(filename,maximum=1048576){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error('PUBLICATION_TYPE_SIZE');const bytes=fs.readFileSync(filename);if(bytes.length!==stat.size)throw Error('PUBLICATION_SIZE');return bytes;}
function pin(filename){const bytes=read(filename);return {path:filename,bytes:bytes.length,mode:fs.lstatSync(filename).mode&4095,sha256:hash(bytes)};}
function save(name,value){if(Date.now()>=deadline)throw Error('PUBLICATION_DEADLINE');fs.writeFileSync(own+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
const oldBytes=read(own+'/SEAL.json');
if(hash(oldBytes)!=='56ad847540e583706fe34e69832bf9c439a0b69e416c742941e3e45196ef7402')throw Error('OLD_SEAL_DRIFT');
const old=JSON.parse(oldBytes);
for(const row of old.files){const bytes=read(row.path);if(bytes.length!==row.bytes||hash(bytes)!==row.sha256||(fs.lstatSync(row.path).mode&4095)!==row.mode)throw Error('OLD_HELPER_DRIFT');}
const controls=JSON.parse(read(own+'/CONTROLS.json'));
if(controls.total!==12||controls.passed!==12||controls.managedChildren!==3||!controls.retired||controls.productEvaluations!==0||controls.actualAdmissionMembers!==1010)throw Error('CONTROL_RESULT');
for(const row of controls.results.filter(row=>row.lifecycle)){if(!row.lifecycle.qualified||row.lifecycle.knownOutstanding!==0||!row.lifecycle.exit||!row.lifecycle.close||!row.lifecycle.stdoutEOF||!row.lifecycle.stderrEOF)throw Error('CONTROL_RETIREMENT');}
const expected=read(own+'/launch.sh').toString().replace('preexec-v1/BOOTSTRAP.sha256','preexec-v1/BOOTSTRAP-v2.sha256').replace('\n"$NODE" /Users/','\nexec "$NODE" /Users/');
if(read(own+'/launch-v2.sh').toString()!==expected)throw Error('LAUNCH_DELTA');
const files=[...old.files,...['launch-v2.sh','publish.mjs','HANDOFF.md'].map(name=>pin(own+'/'+name))];
fs.writeFileSync(own+'/BOOTSTRAP-v2.sha256',files.map(row=>row.sha256+'  '+row.path+'\n').join(''),{flag:'wx'});
const seal={...old,schema:'pipestatus-preexec-v2',files,bootstrap:pin(own+'/BOOTSTRAP-v2.sha256'),launcher:pin(own+'/launch-v2.sh'),predecessorSealSha256:hash(oldBytes),launcherQualification:'Source-only exact two replacements; exec replaces waiting shell, retaining process peak three. Actual launcher UNRUN.'};
save('SEAL-v2.json',seal);
const sealPin=pin(own+'/SEAL-v2.json');
save('GRANT-v2.template.json',{action:'execute-pipestatus-78-v1',sealSha256:sealPin.sha256,rootReceipt:'REQUIRES_FUTURE_ROOT_DURABLE_40_HEX_COMMIT',started:'REQUIRES_FUTURE_INTEGER_MS',deadline:'started+1800000'});
const rawNames=['controls-dispatch.stdout','controls-dispatch.stderr','publication-patch.stdout','publication-patch.stderr'];
const raw=[];for(const name of rawNames){const filename=work+'/'+name;const bytes=read(filename);fs.writeFileSync(own+'/raw-'+name,bytes,{flag:'wx'});raw.push(pin(own+'/raw-'+name));}
const census={files:0,bytes:0};function walk(directory){for(const name of fs.readdirSync(directory)){const filename=path.join(directory,name),stat=fs.lstatSync(filename);if(stat.isDirectory())walk(filename);else if(stat.isFile()&&!stat.isSymbolicLink()){census.files++;census.bytes+=stat.size;}else throw Error('WORK_CENSUS_TYPE');}}walk(work);
const roles=read(work+'/roles.log');fs.writeFileSync(own+'/KNOWN-ROLES.snapshot.txt',roles,{flag:'wx'});
const record={seal:sealPin,bootstrap:pin(own+'/BOOTSTRAP-v2.sha256'),controls:pin(own+'/CONTROLS.json'),raw,workCensus:census,publicationAt:Date.now(),deadline,productExecutions:0,Workers:0,helpers:'Three PURE helpers: prepare, controls, publish. Three harmless children with exit/close/both EOF/capture closure. No active managed children.',knownRoles:'51 starts through this helper, followed by bounded publication; snapshot contains actual returned roles and launch enrolment. Final shell/Git receipts are separate.',originalSealPreserved:hash(read(own+'/SEAL.json'))===hash(oldBytes),command:'ROOT must bind literal SEAL-v2 size/hash, BOOTSTRAP-v2 hash and fresh grant path/size/hash, then /bin/zsh '+own+'/launch-v2.sh; NOT authorized now.'};
save('PUBLICATION.json',record);
console.log(JSON.stringify({seal:sealPin,bootstrap:record.bootstrap,controls:'12/12',retired:3,workCensus:census,productExecutions:0,Workers:0}));
