import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './path-bytes.mjs';
const own = path.dirname(fileURLToPath(import.meta.url));
const describe = name => { const filename = path.join(own, name), bytes = fs.readFileSync(filename); return { path: name, bytes: bytes.length, mode: fs.statSync(filename).mode & 0o777, sha256: sha256(bytes) }; };
assert.equal(fs.existsSync(path.join(own, 'EXECUTION-SEAL.json')), false);
const paths = fs.readdirSync(own).filter(name => name !== 'inventory-v1' && name !== 'ROOT-COORDINATION.md').concat(fs.readdirSync(path.join(own, 'inventory-v1')).map(name => 'inventory-v1/' + name));
for (const directory of ['actual-v1', 'admission-plan', 'matrix']) for (const name of fs.readdirSync(path.join(own, '..', directory))) {
  if (fs.statSync(path.join(own, '..', directory, name)).isFile()) paths.push('../' + directory + '/' + name);
}
const entries = paths.sort().map(describe);
const old = JSON.parse(fs.readFileSync(path.join(own, '../actual-v1/EXECUTION-SEAL.json')));
const seal = { ...old, schema: 'apply-patch-independent-path-transport-execution-seal-v2', sealedAt: new Date().toISOString(), authority: { source: old.authority.source, evidence: old.authority.evidence, userGo: null, required: 'FRESH ROOT GO; one future attempt only' }, metadataSha256: describe('METADATA.json').sha256, files: Object.fromEntries(entries.map(({ path: name, ...entry }) => [name, entry])), repair: { version: 2, expected: describe('EXPECTED.json'), actual98: describe('inventory-v1/ACTUAL98.json'), transport: 'NUL byte capture / first TAB header', readRouteDelta: 'none', budgetDelta: 'none', futureOutputHashes: null, futureOutputDerivation: 'unchanged selected274 + sealed TypeScript/config/tool closure => BUILD-RECEIPT full882 package/emissions => committed RUNTIME-SEAL exact app/loader/worker/mutations => RUNTIME-START; unknown hashes not invented', historicalHold: 'ad08d510 /0297e41c: original25DATA/68NOTRUN' } };
const serialized = JSON.stringify(seal, null, 2) + '\n';
const preseal = { schema: 'path-transport-v2-data-preseal', classification: 'freeze before DATA/SYNTHETIC authentication', files: [...entries, { path: 'EXECUTION-SEAL.json', bytes: Buffer.byteLength(serialized), mode: 420, sha256: sha256(serialized) }], expectedControlCount: 65, independentComparator: 'independent-tree.mjs', futureExecution: 'HOLD; fresh root GO required' };
console.log('*** Begin Patch');
for (const [name, text] of [['EXECUTION-SEAL.json', serialized], ['PRESEAL.json', JSON.stringify(preseal, null, 2) + '\n']]) console.log('*** Add File: tests/commands/apply-patch-independent-20260828/path-transport-v2/' + name + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n'));
console.log('*** End Patch');
