import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,fstatSync,symlinkSync,unlinkSync,readlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const supplied=JSON.parse(readFileSync(process.argv[2]));
const load=name=>import(pathToFileURL(join(supplied.driver,name)).href);
const {openFencedWorker}=await load('fenced-supervisor.mjs');
const scope=openFencedWorker();
const root=scope.envelope.roots[0].path,output=scope.envelope.roots[1].path;
const temporary=join(root,'component');mkdirSync(temporary);mkdirSync(join(temporary,'harness'));
const compilerBytes=readFileSync('/Users/kjopek/Workspace/safe-bash/node_modules/typescript/bin/tsc');assert.equal(createHash('sha256').update(compilerBytes).digest('hex'),'8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0');mkdirSync(join(root,'node_modules/typescript/bin'),{recursive:true});writeFileSync(join(root,'node_modules/typescript/bin/tsc'),compilerBytes,{flag:'wx'});
const input={...supplied,root,output};writeFileSync(join(root,'input.json'),JSON.stringify(input));
copyFileSync(supplied.probe,join(root,'probe.mjs'));
copyFileSync(supplied.guard,join(temporary,'harness','guard.mjs'));
writeFileSync(join(temporary,'harness','expected.json'),'{}');
const {createBuildAudit}=await load('build-types.mjs');const audit=createBuildAudit(root,temporary);
const {createPhaseRunner}=await load('phase-runner.mjs');
const {createToolPath,verifyToolPath}=await load('tool-routing.mjs');const toolPath=createToolPath(root);writeFileSync(join(root,'tool-path.json'),JSON.stringify(toolPath));
const native=join(root,'native');mkdirSync(native);const nativeEnvironment={PATH:native+':'+toolPath.path,GIT_EXEC_PATH:toolPath.gitCore.origin};assert.equal(verifyToolPath(toolPath,nativeEnvironment,native),true);const shadows=[];
for(const kind of ['regular','symlink']){const path=join(native,'git');if(kind==='regular')writeFileSync(path,'#!/bin/sh\nprintf unsafe > '+JSON.stringify(join(root,'unapproved-dispatched'))+'\n',{flag:'wx',mode:0o755});else symlinkSync(toolPath.aliases.find(row=>row.name==='git').physical,path);let refusal;try{verifyToolPath(toolPath,nativeEnvironment,native);}catch(error){refusal={message:error.message,code:error.code};}assert.match(refusal?.message??'',/unbound native PATH entry|must not become aliases/u);assert.equal(existsSync(join(root,'unapproved-dispatched')),false);shadows.push({kind,refusal,markerAbsent:true});unlinkSync(path);}
const gitAlias=join(toolPath.path,'git'),originalTarget=readlinkSync(gitAlias);unlinkSync(gitAlias);symlinkSync('/usr/bin/git',gitAlias);let aliasRefusal;try{verifyToolPath(toolPath,nativeEnvironment,native);}catch(error){aliasRefusal={message:error.message,code:error.code};}assert.ok(aliasRefusal);shadows.push({kind:'changed-alias',refusal:aliasRefusal});unlinkSync(gitAlias);symlinkSync(originalTarget,gitAlias);assert.equal(verifyToolPath(toolPath,nativeEnvironment,native),true);
const report={phases:[]},completed=[];
const environment={PATH:toolPath.path,GIT_EXEC_PATH:toolPath.gitCore.origin,HOME:join(root,'home'),TMPDIR:join(root,'tmp'),TMP:join(root,'tmp'),TEMP:join(root,'tmp'),LANG:'C',LC_ALL:'C',FULL_GATE_ROOT:root,FULL_GATE_SOURCE:root,FULL_GATE_EXPECTED:join(temporary,'harness','expected.json'),FULL_GATE_TOOL_ROOTS:'[]'};
const phase=createPhaseRunner({completed,report,source:root,output,environment,guard:join(temporary,'harness','guard.mjs'),verify:async()=>{assert.equal(readFileSync(join(root,'probe.mjs'),'utf8'),readFileSync(supplied.probe,'utf8'));verifyToolPath(toolPath,environment);},requireOrdered:(actual,next)=>assert.equal(next,supplied.phases[actual.length]),audit,supervision:scope.supervise});
for(const label of supplied.phases){const row=await phase(label,[join(root,'probe.mjs'),join(root,'input.json'),label],root,0,20000);if(row.status!==0)throw Error('Independent probe failed: '+label);}
const descriptors=[];for(let descriptor=0;descriptor<128;descriptor++){try{const stat=fstatSync(descriptor);descriptors.push({descriptor,regular:stat.isFile(),device:stat.dev,inode:stat.ino});assert.ok(!(stat.isFile()&&stat.dev===input.canaryIdentity.device&&stat.ino===input.canaryIdentity.inode));}catch(error){if(error.code!=='EBADF')throw error;}}
writeFileSync(join(output,'INDEPENDENT-WORKER.json'),JSON.stringify({report,descriptors,toolPath,shadows,componentOnly:true,fullGate:false},null,2));
if(process.connected)process.disconnect();
