import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,cpSync,readdirSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),repo='/Users/kjopek/Workspace/safe-bash';
const phase=process.argv[2],output=join(root,phase),archive=join(output,'archive');
assert.match(phase,/^[a-z0-9-]+$/);assert.ok(!existsSync(output));mkdirSync(archive,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:128*1024*1024});
const pin=git('rev-parse','HEAD').toString().trim();git('merge-base','--is-ancestor','0bee8e7',pin);
const independent='tests/fs/mount/identity-authority-review/implementation';
const tar=git('archive',pin,'src','tests/fs/webdav','tests/fs/conformance','tests/fs/mount/identity-compatibility-review/compatibility.test.ts',`${independent}/remote-comparison.test.ts`,`${independent}/support.ts`,'package.json','package-lock.json','tsconfig.json','tsconfig.build.json');
assert.equal(spawnSync('tar',['-xf','-','-C',archive],{input:tar}).status,0);
for(const path of ['src/fs/webdav','tests/fs/webdav'])cpSync(join(repo,path),join(archive,path),{recursive:true});
symlinkSync(join(repo,'node_modules'),join(archive,'node_modules'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const walk=path=>readdirSync(join(archive,path),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?entry.name==='evidence'?[]:walk(join(path,entry.name)):[join(path,entry.name)]);
const files=[...walk('src'),...walk('tests/fs/webdav'),...walk('tests/fs/conformance'),`${independent}/remote-comparison.test.ts`,`${independent}/support.ts`,'tests/fs/mount/identity-compatibility-review/compatibility.test.ts','package.json','package-lock.json'].sort();
const manifest=()=>files.map(path=>({path,sha256:hash(readFileSync(join(archive,path)))}));
const save=(name,value)=>writeFileSync(join(output,name),JSON.stringify(value,null,2)+'\n');
const before=manifest();save('manifest-before.json',before);save('provenance.json',{phase,pin,requiredCore:'0bee8e7',ownedOverlay:true,node:process.version,archiveBaseSha256:hash(tar),status:git('status','--short').toString()});
const commands=[];
if(phase!=='baseline')commands.push({name:'build',args:['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']});
if(true){
 const tests=walk('tests/fs/webdav').filter(path=>path.endsWith('.test.ts')&&!path.endsWith('/binding-violations.test.ts')&&!path.includes('/consumer/'));
 commands.push({name:'webdav-all',args:['--unhandled-rejections=strict','--import','tsx','--test',...tests]},
 
 {name:'original-webdav15',args:['--unhandled-rejections=strict','--import','tsx','--test','--test-name-pattern=webdav','tests/fs/mount/identity-compatibility-review/compatibility.test.ts']},
 {name:'webdav-conformance',args:['--unhandled-rejections=strict','--import','tsx','--test','--test-name-pattern=^webdav:|^independent conformance source provenance$|^conformance source state remained stable during suite$','tests/fs/conformance/shared.test.ts']},
 {name:'types',args:['node_modules/typescript/bin/tsc','--noEmit','--target','ES2023','--lib','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--strict','--noUncheckedIndexedAccess','--exactOptionalPropertyTypes','--verbatimModuleSyntax','--skipLibCheck','--types','node',...walk('src/fs/webdav').filter(path=>path.endsWith('.ts')),...walk('tests/fs/webdav').filter(path=>path.endsWith('.ts'))]});
}
if(existsSync(join(archive,'tests/fs/webdav/binding-violations.test.ts')))commands.push({name:'noncompliant-characterizations',args:['--unhandled-rejections=strict','--import','tsx','--test','tests/fs/webdav/binding-violations.test.ts']});
if(phase!=='baseline')commands.push({name:'consumer-types',args:['node_modules/typescript/bin/tsc','--target','ES2023','--lib','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--strict','--noUncheckedIndexedAccess','--exactOptionalPropertyTypes','--verbatimModuleSyntax','--skipLibCheck','--types','node','--rootDir','tests/fs/webdav/consumer','--outDir','consumer-out','tests/fs/webdav/consumer/example.ts','tests/fs/webdav/consumer/provider.ts','tests/fs/webdav/consumer/consumer.test.ts']},{name:'built-consumer',args:['--unhandled-rejections=strict','--test','consumer-out/consumer.test.js']});
save('commands.json',commands);
for(const command of commands){const start=new Date().toISOString();const result=spawnSync(process.execPath,command.args,{cwd:archive,encoding:'utf8',timeout:120000,maxBuffer:24*1024*1024,env:{...process.env,TMPDIR:output,TSX_DISABLE_CACHE:'1'}});writeFileSync(join(output,command.name+'.stdout'),result.stdout??'');writeFileSync(join(output,command.name+'.stderr'),result.stderr??'');save(command.name+'.exit.json',{argv:[process.execPath,...command.args],cwd:archive,start,end:new Date().toISOString(),status:result.status,signal:result.signal,error:result.error?.message});console.log(phase,command.name,result.status);}
assert.deepEqual(manifest(),before);save('manifest-after.json',manifest());
