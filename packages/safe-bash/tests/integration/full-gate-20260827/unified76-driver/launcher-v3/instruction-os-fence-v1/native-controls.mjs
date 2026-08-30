import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {node24,save,sha} from '../common.mjs';
import {createInstructionFence,instructionFenceInvocation} from '../os-instruction-fence.mjs';
import {supervise} from '../supervise.mjs';

const outer=realpathSync(mkdtempSync('/private/tmp/unified76-os-native-')),outside=join(outer,'outside');mkdirSync(outside);mkdirSync(join(outside,'directory'));writeFileSync(join(outside,'ordinary'),'original');writeFileSync(join(outside,'directory','ordinary'),'original');
const envelope=createInstructionFence('/tmp/unified76-build-types-review-native-'+process.pid),root=envelope.roots[0].path,script=join(outer,'probe.mjs');
const body=String.raw`
import assert from 'node:assert/strict';import{spawnSync}from'node:child_process';import{writeFileSync,readFileSync,existsSync,lstatSync}from'node:fs';import{join}from'node:path';
const [root,outside]=process.argv.slice(2),inner=join(root,'inner.sh'),outer=join(root,'outer.sh'),target=join(root,'AGENTS.md');
writeFileSync(inner,'echo "INNER:$$"\n/usr/bin/touch "$1"\nstatus=$?\nexit "$status"\n');
writeFileSync(outer,'echo "OUTER:$$"\n/usr/bin/env -i /bin/sh "$1" "$2"\nstatus=$?\nexit "$status"\n');
const child=spawnSync('/usr/bin/env',['-i','/bin/sh',outer,inner,target],{encoding:'utf8',timeout:5000});assert.equal(child.status,1);assert.equal(child.signal,null);assert.match(child.stderr,/Operation not permitted|Permission denied/u);const pids=/^OUTER:(\d+)\nINNER:(\d+)\n$/u.exec(child.stdout);assert.ok(pids);assert.notEqual(pids[1],pids[2]);assert.equal(existsSync(target),false);
const source=join(root,'ordinary');writeFileSync(source,'original');const cases=[['/bin/mv',[source,target]],['/bin/ln',[source,target]],['/bin/ln',['-s','ordinary',target]],['/bin/mv',[join(outside,'directory'),join(root,'imported-directory')]],['/bin/ln',[join(outside,'ordinary'),join(root,'imported-file')]]];
for(const[file,args]of cases){const result=spawnSync(file,args,{env:{},encoding:'utf8',timeout:5000});assert.equal(result.status,1,result.stderr);assert.equal(result.signal,null);assert.match(result.stderr,/Operation not permitted|Permission denied/u);}
assert.equal(readFileSync(source,'utf8'),'original');assert.equal(readFileSync(join(outside,'directory','ordinary'),'utf8'),'original');assert.equal(lstatSync(join(outside,'ordinary')).nlink,1);for(const name of ['AGENTS.md','imported-directory','imported-file'])assert.throws(()=>lstatSync(join(root,name)),{code:'ENOENT'});
const positive=spawnSync('/bin/ln',[source,join(root,'ordinary-link')],{env:{},encoding:'utf8',timeout:5000});assert.equal(positive.status,0,positive.stderr);assert.equal(lstatSync(source).nlink,2);console.log(JSON.stringify({nativePids:pids.slice(1),denials:cases.length+1,ordinaryHardlink:true}));
`;
writeFileSync(script,body,{flag:'wx'});const invocation=instructionFenceInvocation(envelope,node24,[script,root,outside],process.env);
const result=await supervise(invocation.executable,invocation.args,{cwd:root,env:invocation.env,timeoutMs:30000,maxOutputBytes:1024*1024,stdout:join(outer,'stdout'),stderr:join(outer,'stderr'),observeSockets:true});
save(join(outer,'REPORT.json'),{at:new Date().toISOString(),envelope,result,scriptSha256:sha(body),sourceSha256:sha(readFileSync(new URL(import.meta.url))),fullGate:false});console.log(JSON.stringify({outer,status:result.status,clean:result.clean}));assert.equal(result.status,0,readFileSync(join(outer,'stderr'),'utf8'));assert.equal(result.clean,true);
