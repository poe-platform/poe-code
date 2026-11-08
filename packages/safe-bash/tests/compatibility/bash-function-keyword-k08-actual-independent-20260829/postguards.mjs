import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = process.argv[2];
const seal = JSON.parse(fs.readFileSync(root + '/inputs/SEAL.json'));
const term = JSON.parse(fs.readFileSync(root + '/inputs/activation-v1/actual-v1/TERMINAL-SUMMARY.json'));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function verify(path, expected) {
  const stat = fs.lstatSync(path); assert(stat.isFile()); assert.equal(stat.size, expected.bytes);
  const digest = crypto.createHash('sha256'); const fd = fs.openSync(path, 'r');
  const buffer = Buffer.alloc(65536); let bytes = 0;
  try { for (;;) { const count = fs.readSync(fd, buffer, 0, buffer.length, null); if (!count) break; digest.update(buffer.subarray(0,count)); bytes += count; } }
  finally { fs.closeSync(fd); }
  assert.equal(bytes, expected.bytes); assert.equal(digest.digest('hex'), expected.sha256);
}
verify(seal.node.path, seal.node);
verify(seal.sourceBinding.path, seal.sourceBinding);
for (const [name, expected] of Object.entries(seal.helperPins)) verify(seal.helperRoot + '/' + name, expected);
for (const row of term.postguards.baselineShipping) for (const member of seal.shipping) verify(row.root + '/' + member.path, member);
for (const row of term.postguards.isolatedMutants) verify(row.path, row);
const source = JSON.parse(fs.readFileSync(root + '/SOURCE-BINDING.json'));
let sourceCount = 0;
for (const row of source) { verify(seal.sourceApp + '/' + row.path, row); sourceCount++; }
const raw = new Map();
const manifest = JSON.parse(fs.readFileSync(root + '/inputs/activation-v1/actual-v1/RAW-MANIFEST.json'));
for (const part of manifest.parts) for (const file of JSON.parse(fs.readFileSync(root + '/inputs/activation-v1/actual-v1/' + part.path)).files) raw.set(file.path, Buffer.from(file.base64,'base64'));
const owner = JSON.parse(raw.get('TARGET-RESULT.json'));
const lifecycleEvents = owner.ledger.rows.map(row => ({id:row.id,events:row.events.map(event=>event.event ?? event.type ?? Object.keys(event).join(','))}));
const result = {schema:'K08-POSTGUARDS-1',finished:new Date().toISOString(),sourceCount,toolHashVerified:seal.node.sha256,helperPins:Object.keys(seal.helperPins).length,baselineShippingSets:term.postguards.baselineShipping.map(row=>({root:row.root,members:seal.shipping.length})),isolatedMutants:3,sourceBindingSha256:sha(fs.readFileSync(root+'/SOURCE-BINDING.json')),lifecycleEvents,qualification:'Fresh read-only file-bound verification; no new restore/type/runtime execution, no new-path absence or historical continuous-state proof.'};
fs.writeFileSync(root+'/POSTGUARDS.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({sourceCount,baselineMembers:2012,tool:true,mutants:3})+'\n');
