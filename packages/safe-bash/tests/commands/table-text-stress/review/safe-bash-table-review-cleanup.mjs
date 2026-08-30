import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {work,save,sha} from './safe-bash-table-review-tools.mjs';
const removed=[];
for (const snapshot of ['audit','closed']) {
  const base=`${work}/${snapshot}/tests/commands/table-text-stress`;
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base,{withFileTypes:true})) {
    if (!entry.isDirectory() || !entry.name.startsWith('.native-')) continue;
    const path=`${base}/${entry.name}`;
    assert.equal(readFileSync(`${path}/sentinel`,'utf8'),'independent-table-text-owned');
    const names=readdirSync(path).sort();
    assert.ok(names.every(name=>['sentinel','left','right'].includes(name)));
    removed.push({path,files:Object.fromEntries(names.map(name=>[name,sha(readFileSync(`${path}/${name}`))]))});
    rmSync(path,{recursive:true});
  }
}
save(`${work}/native-cleanup-${process.argv[2]??'final'}.json`,{time:new Date().toISOString(),removed});
console.log(`Verified and removed ${removed.length} owned native fixture directories.`);
