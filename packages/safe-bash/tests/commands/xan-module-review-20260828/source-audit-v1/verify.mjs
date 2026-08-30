import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const read = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const audit = read('AUDIT.json');
const inputs = read('PINNED-INPUTS.json');
const seal = read('SEAL.json');
const expectedFiles = ['AUDIT.json', 'PINNED-INPUTS.json', 'REPORT.md', 'SEAL.json', 'verify.mjs'].sort();
assert.deepEqual(readdirSync(directory).sort(), expectedFiles, 'Added/removed owned artifact');
for (const name of expectedFiles) assert(lstatSync(resolve(directory, name)).isFile(), `Nonregular artifact ${name}`);
assert.equal(git('rev-parse', '--show-toplevel').toString().trim(), repository);
assert.equal(seal.classification, 'SOURCE_AUDIT_ARTIFACT_SEAL_NOT_PRODUCT_EVIDENCE');
assert.deepEqual(seal.artifacts.map(entry => entry.path).sort(), expectedFiles.filter(name => name !== 'SEAL.json'));
for (const entry of seal.artifacts) {
  const bytes = readFileSync(resolve(directory, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(sha256(bytes), entry.sha256, entry.path);
}
const pinned = new Map();
for (const entry of inputs.inputs) {
  assert(!pinned.has(entry.id), `Duplicate input ${entry.id}`);
  const bytes = git('show', `${entry.revision}:${entry.path}`);
  assert.equal(git('rev-parse', `${entry.revision}:${entry.path}`).toString().trim(), entry.blob, entry.id);
  assert.equal(bytes.length, entry.bytes, entry.id);
  assert.equal(sha256(bytes), entry.sha256, entry.id);
  const lines = bytes.toString('utf8').split('\n').length - Number(bytes.at(-1) === 10);
  assert.equal(lines, entry.lines, entry.id);
  pinned.set(entry.id, { ...entry, contents: bytes.toString('utf8') });
}
function checkReferences(value) {
  if (typeof value === 'string') {
    const match = /^(candidate\/[^:]+|base\/[^:]+|policy\/[^:]+|prep\/[^:]+):(\d+)-(\d+)$/.exec(value);
    if (match) {
      assert(pinned.has(match[1]), `Unknown source reference ${value}`);
      assert(Number(match[2]) >= 1 && Number(match[2]) <= Number(match[3]));
      assert(Number(match[3]) <= pinned.get(match[1]).lines, `Out-of-range reference ${value}`);
    }
  } else if (value && typeof value === 'object') for (const item of Object.values(value)) checkReferences(item);
}
checkReferences(audit);
const frozenLimits = JSON.parse(pinned.get('freeze/final-freeze-v3/LIMITS.json').contents);
assert.equal(frozenLimits.rows.length, 18);
assert.equal(audit.recipes.length, 18);
assert.deepEqual(audit.recipes.map(row => row.name), frozenLimits.rows.map(row => row.name));
const optionsText = pinned.get('candidate/options.ts').contents;
const defaultsText = /export const defaultLimits = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(optionsText)[1];
const ceilingsText = /export const hardLimits: XanLimits = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(optionsText)[1];
const numericLiterals = text => Object.fromEntries([...text.matchAll(/(max\w+):\s*(\d+)/g)].map(match => [match[1], Number(match[2])]));
const defaults = numericLiterals(defaultsText);
const ceilings = numericLiterals(ceilingsText);
assert.equal(Object.keys(defaults).length, 18);
assert.equal(Object.keys(ceilings).length, 18);
for (const [index, row] of frozenLimits.rows.entries()) {
  assert.equal(defaults[row.name], row.defaultValue);
  assert.equal(ceilings[row.name], row.hardCeiling);
  assert.equal(audit.recipes[index].defaultValue, row.defaultValue);
  assert.equal(audit.recipes[index].hardCeiling, row.hardCeiling);
}
assert.equal(JSON.parse(pinned.get('freeze/final-freeze-v3/CASES.json').contents).cases.length, audit.inventory.priorReferences);
assert.equal(JSON.parse(pinned.get('freeze/final-freeze-v3/CONTROLS.json').contents).families.length, audit.inventory.families);
assert.equal(JSON.parse(pinned.get('freeze/B01-RATIFICATION-7.json').contents).rules.length, audit.inventory.ratifications);
assert.equal(JSON.parse(pinned.get('freeze/SELECTOR-FREEZE-V4.json').contents).cases.length, audit.inventory.selectors);
assert.equal(audit.inventory.changed, false);
assert.deepEqual(audit.findings.map(finding => finding.id), ['SA-01', 'SA-02', 'SA-03']);
for (const finding of audit.findings) {
  assert.equal(finding.reproduction.status, 'UNEXECUTED');
  assert.equal(finding.reproduction.observedRaw, null);
}
for (const count of Object.values(audit.execution)) assert.equal(count, 0);
const treePaths = revision => git('ls-tree', '-r', '--name-only', revision, '--', 'src').toString().trim().split('\n').filter(name => name.endsWith('.ts'));
const baselinePaths = [...treePaths(audit.baseline), 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].sort();
assert.equal(baselinePaths.length, 215);
const candidatePaths = git('ls-tree', '-r', '--name-only', audit.candidate, '--', 'src/commands/xan').toString().trim().split('\n').filter(name => name.endsWith('.ts'));
assert.equal(candidatePaths.length, 10);
assert.deepEqual(candidatePaths, inputs.inputs.filter(entry => entry.id.startsWith('candidate/')).map(entry => entry.path).sort());
const origin = new Map(baselinePaths.map(path => [path, audit.baseline]));
for (const path of candidatePaths) origin.set(path, audit.candidate);
const composition = [...origin].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([path, revision]) => {
  const bytes = git('show', `${revision}:${path}`);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
});
assert.equal(composition.length, 225);
assert.equal(sha256(JSON.stringify(composition)), audit.compositionInventorySha256);
const author = JSON.parse(pinned.get('author/manifest').contents);
assert.equal(author.candidate, audit.candidate);
assert.equal(author.baseline, audit.baseline);
assert.equal(author.freeze, audit.freeze);
assert.equal(author.compositionIdentity, audit.compositionInventorySha256);
for (const entry of author.sourceInventory) {
  const local = pinned.get(`candidate/${entry.path.split('/').at(-1)}`);
  assert(local, entry.path);
  assert.equal(local.blob, entry.blob);
  assert.equal(local.sha256, entry.sha256);
}
const ledger = audit.findings.find(finding => finding.id === 'SA-02').staticLedger;
assert.equal(ledger.headerControlBytes + ledger.rawPlusDecodedCapacity + ledger.nameAndDisplayUtf16Bytes, ledger.liveBeforeText);
assert.equal(ledger.liveBeforeText + ledger.encodedLineBytes, ledger.implementedTextHold);
assert.equal(ledger.implementedTextHold + ledger.omittedLineUtf16Bytes, ledger.requiredSimultaneousLowerBound);
assert(ledger.implementedLargestEarlierHold < ledger.configuredLimit && ledger.requiredSimultaneousLowerBound > ledger.configuredLimit);
assert.equal(1024 * 128 * 2048, audit.recipes.find(row => row.name === 'maxOutputBytes').defaultValue);
assert.equal(1024 * 128 * 32768, audit.recipes.find(row => row.name === 'maxOutputBytes').hardCeiling);
console.log(JSON.stringify({ classification: 'ARTIFACT_CONSISTENCY_ONLY', verifiedAtUTC: new Date().toISOString(), pinnedInputs: pinned.size, composedInventoryEntries: composition.length, recipes: 18, findings: 3, productExecutions: 0, appendCheck: 'Exact owned-directory enumeration; not a whole-worktree gate', sealSha256: sha256(readFileSync(resolve(directory, 'SEAL.json'))) }, null, 2));
