import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const owned = resolve('tests/stress/regex-execution/production-continuation-review');
const snapshot = resolve(owned, 'snapshots/candidate');
const moved = resolve(owned, '.temporary/moved');
const packageRoot = resolve(moved, 'node_modules/virtual-bash');
await mkdir(packageRoot, {recursive:true});
await mkdir(resolve(owned,'evidence/packed'), {recursive:true});
await writeFile(resolve(moved,'package.json'), JSON.stringify({name:'independent-continuation-consumer',private:true,type:'module'})+'\n', {flag:'wx'});
const commands=[];
function run(executable,args,cwd=moved) {
  const result=spawnSync(executable,args,{cwd,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  const record={executable,args,cwd,status:result.status,signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr};
  commands.push(record);
  if(result.status!==0) throw new Error(JSON.stringify(record));
  return record;
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let failure;
const assets=[];
try {
  const pack=run('npm',['pack','--ignore-scripts','--json','--pack-destination',moved],snapshot);
  const metadata=JSON.parse(pack.stdout)[0];
  const archive=resolve(moved,metadata.filename);
  run('/usr/bin/tar',['-xzf',archive,'-C',packageRoot,'--strip-components=1']);
  await copyFile(resolve(owned,'child.mjs'),resolve(moved,'child.mjs'));
  await copyFile(resolve(owned,'walker-cases.mjs'),resolve(moved,'walker-cases.mjs'));
  await copyFile(resolve(owned,'package-consumer.mts'),resolve(moved,'consumer.mts'));
  const fixture=(await readFile(resolve(owned,'../production-review/cohort.mjs'),'utf8'))+(await readFile(resolve(owned,'cohort.mjs'),'utf8')).replace("export { cases } from '../production-review/cohort.mjs';",'');
  await writeFile(resolve(moved,'cohort.mjs'),fixture,{flag:'wx'});
  run(resolve('node_modules/.bin/tsc'),['--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023','--lib','ES2023','--strict','--skipLibCheck',resolve(moved,'consumer.mts')]);
  const build=JSON.parse(await readFile(resolve(owned,'evidence/candidate/build.json')));
  for(const entry of build.emitted) {
    if(!entry.path.startsWith('dist/commands/regex-execution/') && !['dist/index.js','dist/index.d.ts','dist/commands/grep.js','dist/commands/search/rg.js','dist/commands/search/glob.js','dist/commands/search/walk.js'].includes(entry.path)) continue;
    const actual=hash(await readFile(resolve(packageRoot,entry.path)));
    assets.push({path:entry.path,sourceSha256:entry.sha256,packedSha256:actual,listed:metadata.files.some(file=>file.path===entry.path)});
    if(actual!==entry.sha256 || !assets.at(-1).listed) throw new Error('packed graph mismatch '+entry.path);
  }
  commands.push({archive,archiveSha256:hash(await readFile(archive)),package:metadata.name,version:metadata.version,dependencies:JSON.parse(await readFile(resolve(packageRoot,'package.json'))).dependencies??{}});
} catch(error) {failure=error.stack;}
await writeFile(resolve(owned,'evidence/packed/package.json'),JSON.stringify({pass:!failure,failure,commands,assets},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({pass:!failure,assets:assets.length,failure}));
if(failure) process.exitCode=1;
