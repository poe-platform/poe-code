import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
const author='/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1';
const work='/private/tmp/pipestatus-independent-preexec-20260829';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename,limit=2097152){const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit);const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);return bytes;}
const sealBytes=read(author+'/SEAL-v2.json');assert.equal(sealBytes.length,795793);assert.equal(hash(sealBytes),'f61b8fb41db61be3ed89fba296f5cbb9a6e8b4c80dd019202b065fe4f5a093d5');
const seal=JSON.parse(sealBytes);for(const row of seal.files){const bytes=read(row.path);assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);}
assert.equal(seal.sources.length,307);assert.equal(seal.cases.length,26);assert.equal(fs.existsSync(work),false);
const source=read(author+'/controls.mjs').toString();
let runner=source.slice(0,source.indexOf("const capture=work+'/harmless'"));
assert.ok(runner.length>3000&&runner.length<5000);
runner=runner.replace("const own='"+author+"';",`const own=${JSON.stringify(author)};`).replace("const work='/private/tmp/safe-bash-pipestatus-preexec';",`const work=${JSON.stringify(work)};fs.mkdirSync(work,{mode:0o700});`);
runner=runner.replace("const prepared=JSON.parse(fs.readFileSync(own+'/PREPARED.json','utf8'));",`const prepared={seal:{bytes:795793,sha256:'f61b8fb41db61be3ed89fba296f5cbb9a6e8b4c80dd019202b065fe4f5a093d5'}};`).replaceAll("own+'/SEAL.json'","own+'/SEAL-v2.json'");
runner=runner.replace('const {preEvaluation,makeRole}', 'const {preEvaluation,makeRole,verifyNpm}');
runner+='\n'+read(own+'/tail.fragment.txt').toString();new vm.SourceTextModule(runner);
fs.writeFileSync(own+'/runner.mjs',runner,{flag:'wx'});
const preseal={schema:'PIPESTATUS_PREEXEC_INDEPENDENT_V1',created:new Date().toISOString(),deadline:'2026-08-29T16:26:20.000Z',source:'4e151da2701a8f4334bbd1f2a4a15f2e3631b990',launcherResult:'c440c86b6b19b95d393b06ad6df65b994531b37b',seal:{bytes:sealBytes.length,sha256:hash(sealBytes)},runner:{bytes:Buffer.byteLength(runner),sha256:hash(Buffer.from(runner))},originalControlSha256:hash(Buffer.from(source)),node:seal.node,files:seal.files,work,controls:['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11-v2','C12-v2','N01','N02','N03','N04','N05','N06','N07','N08'],versionMap:'C01-C09 unchanged bodies; C10 unchanged source positive; C11/C12 merged into one caught-import harmless consumer to obey TWO-child grant, same exact guard/error identities but not original separate exit1 fixtures.',caps:{knownOs:40,peak:3,helpers:2,harmlessChildren:2,workers:0,loaderThreads:0,captureBytes:67108864,workBytes:268435456},roleGraph:{readInspectionAndGit:9,editing:4,prepareRunner:2,harmlessChildren:2,presealGit:4,publicationDataGit:6,readout:1,reserve:12}};
fs.writeFileSync(own+'/EXECUTION-SEAL.json',JSON.stringify(preseal,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({sealSha256:hash(read(own+'/EXECUTION-SEAL.json')),runner:preseal.runner,syntax:true,controls:20}));
