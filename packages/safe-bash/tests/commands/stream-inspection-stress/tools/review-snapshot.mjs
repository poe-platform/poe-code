import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, cpSync, lstatSync, readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, relative, isAbsolute } from 'node:path';

const root='/Users/kjopek/Workspace/safe-bash';
const privateRoot='/tmp/safe-bash-stream-verifier-20260827-A';
const gatePath=process.argv[2]??'/tmp/safe-bash-stream-batch-review.ready';
const expectedAuthorManifest=process.argv[3]??'57c6e29cc6fae6dce5946dddb211b0cc1bf94ef20badb4286546aeafe1e1d553';
const expectedCommit=process.argv[4]??'4af1b107d4b9449a2c4e7fed467d187448392fd5';
if(!existsSync(gatePath)) throw Error('No root final review gate; module execution prohibited');
const gate=readFileSync(gatePath,'utf8');
if(!/CLOSED/.test(gate)) throw Error('Gate must explicitly identify CLOSED author source');
if(!gate.includes(expectedCommit)||!gate.includes(expectedAuthorManifest)) throw Error('Expected commit/hash absent from gate');
const target=join(privateRoot,`snapshot-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`);
mkdirSync(target);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function hashes(directory){
  const output={};
  function walk(path){
    for(const item of readdirSync(path,{withFileTypes:true})){
      const child=join(path,item.name);
      if(item.isDirectory()) walk(child);
      else if(item.isSymbolicLink()) {
        const link=readlinkSync(child);
        const destination=relative(directory,resolve(path,link));
        if(isAbsolute(link)||destination==='..'||destination.startsWith('../')) throw Error(`Escaping snapshot symlink: ${child}`);
        output[child.slice(directory.length+1)]={symlink:link};
      }
      else output[child.slice(directory.length+1)]=hash(readFileSync(child));
    }
  }
  walk(directory);return output;
}
const sourceBefore=hashes(join(root,'src'));
const authorEntries=Object.entries(sourceBefore).filter(([name])=>name.startsWith('commands/stream-inspection/')).sort(([left],[right])=>left<right?-1:left>right?1:0);
const authorManifest=hash(authorEntries.map(([name,digest])=>`src/${name}\0${digest}\n`).join(''));
if(authorManifest!==expectedAuthorManifest) throw Error(`Author source mismatch: ${authorManifest}`);
if(!gate.includes(authorManifest)) throw Error('Author manifest absent from gate');
for(const [name,digest] of authorEntries) {
  const committed=spawnSync('git',['show',`${expectedCommit}:src/${name}`],{cwd:root,maxBuffer:2*1024*1024,timeout:3000});
  if(committed.status!==0||hash(committed.stdout)!==digest) throw Error(`Source differs from CLOSED commit: ${name}`);
}
if(Object.values(sourceBefore).some(value=>typeof value!=='string')) throw Error('Source symlinks prohibited');
const dependencyBefore=hashes(join(root,'node_modules'));
const metadataBefore=Object.fromEntries(['package.json','package-lock.json','tsconfig.json'].map(name=>[name,hash(readFileSync(join(root,name)))]));
for(const name of ['src','node_modules']) cpSync(join(root,name),join(target,name),{recursive:true,verbatimSymlinks:true});
for(const name of ['package.json','package-lock.json','tsconfig.json']) cpSync(join(root,name),join(target,name));
const testDirectory=join(target,'tests/commands/stream-inspection-stress');
mkdirSync(testDirectory,{recursive:true});
cpSync(join(privateRoot,'holdouts.test.ts'),join(testDirectory,'holdouts.test.ts'));
const sourceCopied=hashes(join(target,'src'));
const sourceAfter=hashes(join(root,'src'));
if(JSON.stringify(sourceBefore)!==JSON.stringify(sourceCopied)||JSON.stringify(sourceBefore)!==JSON.stringify(sourceAfter)) throw Error('Concurrent source change during snapshot; frozen copy not approved');
const dependencyCopied=hashes(join(target,'node_modules'));
const dependencyAfter=hashes(join(root,'node_modules'));
if(JSON.stringify(dependencyBefore)!==JSON.stringify(dependencyCopied)||JSON.stringify(dependencyBefore)!==JSON.stringify(dependencyAfter)) throw Error('Dependency mutation during copy');
for(const [name,digest] of Object.entries(metadataBefore)) {
  if(hash(readFileSync(join(root,name)))!==digest||hash(readFileSync(join(target,name)))!==digest) throw Error(`Metadata mutation: ${name}`);
}
if(readFileSync(gatePath,'utf8')!==gate) throw Error('Gate mutated during snapshot');
const git=args=>spawnSync('git',args,{cwd:root,encoding:'utf8'}).stdout;
const manifest={at:new Date().toISOString(),root,target,gate,gateSha256:hash(gate),head:git(['rev-parse','HEAD']).trim(),status:git(['status','--porcelain=v1']),index:git(['diff','--cached','--name-status']),sourceHashes:sourceCopied,snapshotHashes:hashes(target),runtime:{executable:process.execPath,sha256:hash(readFileSync(process.execPath)),version:process.version,platform:process.platform,arch:process.arch},environment:{PATH:process.env.PATH,LC_ALL:'C',TZ:'UTC',STREAM_HOLDOUT_DIR:privateRoot,TSX_DISABLE_CACHE:'1'},testArgv:['--unhandled-rejections=strict','--import','tsx','--test','--test-concurrency=1','--test-reporter=tap','tests/commands/stream-inspection-stress/holdouts.test.ts'],notes:'All needed source, Shell/VFS/helpers, package metadata, installed loader and dependency bytes copied and hashed. No root dist writes. Unrelated dirty source included honestly, not claimed author clean HEAD. Author tests not read/copied/executed.'};
writeFileSync(join(target,'SNAPSHOT.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(privateRoot,'latest-snapshot.txt'),target+'\n');
console.log(JSON.stringify({target,head:manifest.head,sourceFiles:Object.keys(sourceCopied).length,snapshotFiles:Object.keys(manifest.snapshotHashes).length,gateSha256:manifest.gateSha256}));
