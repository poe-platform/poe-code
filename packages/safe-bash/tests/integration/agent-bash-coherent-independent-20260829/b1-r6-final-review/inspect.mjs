import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const own = 'tests/integration/agent-bash-coherent-independent-20260829/b1-r6-final-review';
const base = 'tests/integration/agent-bash-coherent-author-20260829/final-admin-r6';
const records = [];
function read(file, expected) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw Error(`TYPE:${file}`);
  const bytes = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== stat.size || expected && sha256 !== expected) throw Error(`HASH:${file}`);
  records.push({ path: file, bytes: bytes.length, sha256 });
  return bytes.toString('utf8');
}
console.log(read(`${base}/FINAL.json`, '8bd385557c356994062d62fb10d9aef485e3c440dd509e68220425ae770e03a9'));
for (const name of ['PRESEAL.json','COMMAND.json','PUBLICATION-BINDING.json','PUBLICATION-PRESEAL.json','startup-policy.mjs','fixture-v2/PRESEAL.json','fixture-v2/controls.mjs']) {
  console.log(`\n--- ${name} ---\n${read(`${base}/${name}`)}`);
}
console.log('\n--- PUBLISH SOURCE ---\n' + read(`${base}/publish.mjs`));
console.log('\n--- PRIOR RECEIPT ---\n' + read('tests/integration/agent-bash-coherent-independent-20260829/final-admin-r5-review/RECEIPT.json'));
fs.writeFileSync(`${own}/INSPECTED.json`, JSON.stringify({ at: new Date().toISOString(), records }, null, 2) + '\n', { flag: 'wx' });
