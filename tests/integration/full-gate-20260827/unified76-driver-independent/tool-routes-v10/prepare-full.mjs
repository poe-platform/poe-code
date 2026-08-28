import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,readlinkSync,lstatSync,unlinkSync,symlinkSync,realpathSync,mkdirSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const owned=dirname(fileURLToPath(import.meta.url)),binding=JSON.parse(readFileSync(join(owned,'BINDINGS.json'))),repository=join(binding.temporary,'repository');
assert.equal(JSON.parse(readFileSync(join(owned,'SAFETY-RESULTS.json'))).status,'SCOPED_RESOLVED_WRITE_SAFETY_PASS');
const load=name=>import(pathToFileURL(join(binding.driver,name)).href);const {verifyExternal}=await load('external-admission.mjs');const external=await verifyExternal({});
const {cleanGitEnvironment}=await load('transport.mjs'),environment=cleanGitEnvironment({PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',HOME:binding.temporary});const git='/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const run=(args,cwd=repository)=>{const result=spawnSync(git,['--no-replace-objects',...args],{cwd,env:environment,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
run(['init','--quiet','--template=',repository]);
const revisions=[binding.candidate,'284a4c5a193e2001c373fd35806e920bf3ffb90f','6699804ace9f5522aa67be6a017a8008bfc09f30','656ee2b04aa91b1cc40da865173be1b472a2c4ce'];
const producer=spawn(git,['--no-replace-objects','pack-objects','--stdout','--revs'],{cwd:'/Users/kjopek/Workspace/safe-bash',env:environment,stdio:['pipe','pipe','pipe']});
const consumer=spawn(git,['--no-replace-objects','--git-dir',join(repository,'.git'),'index-pack','--stdin'],{cwd:repository,env:environment,stdio:['pipe','pipe','pipe']});
let bytes=0;const hash=createHash('sha256'),logs={};const children=[producer,consumer];const finished=children.map((child,index)=>new Promise((resolve,reject)=>{logs[index]={pid:child.pid,stderr:'',stdout:''};child.stderr.on('data',chunk=>{logs[index].stderr+=chunk;if(Buffer.byteLength(logs[index].stderr)>1048576){child.kill('SIGKILL');reject(Error('setup stderr exceeded'));}});if(index===1)child.stdout.on('data',chunk=>{logs[index].stdout+=chunk;if(Buffer.byteLength(logs[index].stdout)>1048576){child.kill('SIGKILL');reject(Error('setup stdout exceeded'));}});child.once('error',reject);child.once('close',(status,signal)=>resolve({pid:child.pid,status,signal}));}));
const timer=setTimeout(()=>children.forEach(child=>child.kill('SIGKILL')),600000);
producer.stdin.end(revisions.join('\n')+'\n');
let lifecycle;try{await pipeline(producer.stdout,new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>8589934592)return callback(Error('opaque transport byte bound'));hash.update(chunk);callback(null,chunk);}}),consumer.stdin);lifecycle=await Promise.all(finished);assert.ok(lifecycle.every(row=>row.status===0&&row.signal===null));}finally{clearTimeout(timer);}
for(const revision of revisions)assert.equal(run(['rev-parse',revision+'^{commit}']),revision);writeFileSync(join(repository,'.git/HEAD'),binding.candidate+'\n');
const {copyDependencies,verifyAssembly}=await load('common.mjs');const assembly=verifyAssembly(),dependencies=[];
for(const name of ['node_modules','benchmarks/node_modules']){
  const origin=join('/Users/kjopek/Workspace/safe-bash',name),destination=join(repository,name);const projection=copyDependencies(destination,origin),links=[];
  for(const entry of readdirSync(join(origin,'.bin')).sort()){
    const original=join(origin,'.bin',entry),target=realpathSync(original),installed=join(destination,relative(origin,target));assert.ok(target.startsWith(origin+'/'));assert.ok(lstatSync(installed).isFile());
    const relocated=join(destination,'.bin',entry),link=relative(dirname(relocated),installed);unlinkSync(relocated);symlinkSync(link,relocated);links.push({name:entry,originalKind:lstatSync(original).isSymbolicLink()?'symlink':'regular',originalTarget:lstatSync(original).isSymbolicLink()?readlinkSync(original):target,relocatedTarget:link,targetSha256:createHash('sha256').update(readFileSync(installed)).digest('hex')});
  }
  dependencies.push({projection,binTopology:links});
}
const report={source:binding.source,candidate:binding.candidate,repository,external,assembly,opaqueHistory:{revisions,bytes,sha256:hash.digest('hex'),lifecycle,logs,checkout:false,alternates:false,instructionPolicy:'Original opaque objects only; no instruction file materialized'},dependencies,qualification:'First authenticated dependency projection hop; frozen A10 copies this physical staged input again. Original logical benchmark omission remains in this receipt, not claimed as a fresh missing body in second hop.'};
writeFileSync(join(owned,'FULL-SETUP.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'FULL_SETUP_COMPLETE',opaqueBytes:bytes,assembly,dependencies:dependencies.map(row=>({logical:row.projection.logical.files,physical:row.projection.physical.files,omitted:row.projection.metadataOnly.length}))}));
