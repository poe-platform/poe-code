import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, mkdirSync, cpSync, symlinkSync, realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

export const root = '/Users/kjopek/Workspace/safe-bash';
export const work = '/tmp/safe-bash-five-final-review';
export const owned = 'tests/commands/diff-patch-stress/routed-five-review';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', env: {...process.env, GIT_OPTIONAL_LOCKS:'0'}, maxBuffer:64*1024*1024}).trim();
export function save(path, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const lines=text === '' ? '' : text.replace(/\n$/, '').split('\n').map(line=>'+'+line).join('\n')+'\n';
  execFileSync('apply_patch', [], {cwd:root, input:`*** Begin Patch\n*** Add File: ${path}\n${lines}*** End Patch\n`, maxBuffer:64*1024*1024});
}
export function manifest(base, dependencies = true) {
  const files = {};
  function walk(path, key) {
    for (const entry of readdirSync(path, {withFileTypes:true}).sort((left,right)=>left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.native-') || entry.name.startsWith('.snapshot-') || entry.name === '.oracle' || entry.name === 'routed-five-review') continue;
      const child = join(path, entry.name), label = `${key}/${entry.name}`;
      if (entry.isDirectory()) walk(child,label);
      else if(entry.isFile()) files[label] = sha(readFileSync(child));
    }
  }
  for (const name of ['src','tests']) walk(join(base,name),name);
  for (const name of ['package.json','package-lock.json','tsconfig.json','tsconfig.build.json']) files[name]=sha(readFileSync(join(base,name)));
  if(dependencies) walk(realpathSync(join(base,'node_modules')),'node_modules');
  return files;
}
export const drift = (before,after) => [...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(path=>before[path]!==after[path]).map(path=>({path,before:before[path]??null,after:after[path]??null}));
export function snapshot() {
  const closures = Object.fromEntries(['patch-quiet','stat-human'].map(name=> {
    const path=`/tmp/safe-bash-${name}.closed`;
    assert.ok(existsSync(path),`Waiting for author closure ${path}`);
    return [name,{text:readFileSync(path,'utf8'),sha256:sha(readFileSync(path))}];
  }));
  const cwd=join(work,'snapshot');
  assert.ok(!existsSync(cwd),'Snapshot is immutable');
  const liveBefore=manifest(root), headBefore=git('rev-parse','HEAD');
  mkdirSync(cwd,{recursive:true});
  save(join(cwd,'review-owned-sentinel'),'safe-bash-five-final-review\n');
  for(const name of ['src','tests','package.json','package-lock.json','tsconfig.json','tsconfig.build.json']) cpSync(join(root,name),join(cwd,name),{recursive:true,filter:path=>!path.split('/').some(part=>part.startsWith('.native-')||part.startsWith('.snapshot-')||part==='.oracle'||part==='routed-five-review')});
  symlinkSync(join(root,'node_modules'),join(cwd,'node_modules'));
  symlinkSync(join(root,'tests/commands/metadata-stress/.oracle'),join(cwd,'tests/commands/metadata-stress/.oracle'));
  const liveAfter=manifest(root), frozen=manifest(cwd);
  const record={at:new Date().toISOString(),closures,cwd,headBefore,headAfter:git('rev-parse','HEAD'),dirty:git('status','--short'),index:git('diff','--cached','--raw'),liveBefore,liveAfter,frozen,copyDrift:drift(liveBefore,liveAfter),copyDifferences:drift(liveAfter,frozen),node:{version:process.version,executable:process.execPath,sha256:sha(readFileSync(process.execPath))}};
  save(join(work,'snapshot.json'),record);
  assert.deepEqual(record.copyDrift,[],'Concurrent source/test drift: do not accept snapshot');
  assert.deepEqual(record.copyDifferences,[],'Snapshot differs');
  return cwd;
}
if(process.argv[2]==='prepare') {
  assert.ok(!existsSync(join(work,'historical')));
  const report=JSON.parse(readFileSync(join(root,'benchmarks/reports/expanded-20260827/corrected-bd2cacb/report.json')));
  const records={};
  for(const [name,hash] of Object.entries(report.harnessHashes)) {
    const path='benchmarks/expanded/'+name;
    const bytes=execFileSync('git',['show',report.harnessRevision+':'+path],{cwd:root,maxBuffer:32*1024*1024});
    assert.equal(sha(bytes),hash,path);
    save(join(work,'historical',name),bytes.toString());
    assert.equal(sha(readFileSync(join(work,'historical',name))),hash);
    records[path]={frozen:hash,live:sha(readFileSync(join(root,path)))};
  }
  save(join(work,'historical-harness.json'),{at:new Date().toISOString(),revision:report.harnessRevision,records});
  save(join(work,'readonly-audit.txt'),readFileSync('/tmp/safe-bash-five-readonly-audit.txt','utf8'));
  console.log('Frozen original harness verified:',Object.keys(records).length);
}
if(process.argv[2]==='snapshot') console.log(snapshot());
