import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repository = process.cwd();
const oldBase = 'tests/commands/apply-patch-independent-20260828/remaining-harness-v7';
const newBase = 'tests/commands/apply-patch-independent-20260828/remaining-harness-v8';
const oldRoot = path.join(repository, oldBase, 'recipe');
const newRoot = path.join(repository, newBase, 'recipe');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const oldSeal = JSON.parse(fs.readFileSync(path.join(oldRoot, 'DISCOVERY-PRESEAL.json')));
assert.equal(digest(fs.readFileSync(path.join(oldRoot, 'DISCOVERY-PRESEAL.json'))), 'f83d5102f3ac3c8d3d2a3645cb81b4c9291ccab5cf8a0da7c7ba4363d0fa5530');
const files = {};
for (const [name, binding] of Object.entries(oldSeal.files)) {
  const bytes = fs.readFileSync(path.join(oldRoot, name));
  assert.equal(bytes.length, binding.bytes);
  assert.equal(digest(bytes), binding.sha256);
  assert.equal(fs.lstatSync(path.join(oldRoot, name)).mode & 0o777, binding.mode);
  files[name] = bytes.toString('utf8');
}
function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, before);
  return text.replace(before, after);
}
const input = JSON.parse(files['INPUTS-v6.json']);
const body = Buffer.from(`${input.bodyPrefix}${input.variants[0]}\n`);
const preparation = {
  directory: path.join(newRoot, 'attempt-01/work/positive/refusals'),
  bodyBase64: body.toString('base64'),
  bodySha256: digest(body),
  mode: input.mode,
  regularNames: ['link-target', 'alias-source'],
  symlink: { name: 'symlink', target: 'link-target' },
  hardlink: { name: 'alias', source: 'alias-source' },
};
const preparationLiteral = JSON.stringify(preparation);
let owner = files['owner.mjs'];
owner = replaceOnce(owner, 'function workPut(filename, value) {', 'function workPut(filename, value, mode = 0o600) {');
owner = replaceOnce(owner, "fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o600 });", "fs.writeFileSync(filename, bytes, { flag: 'wx', mode });");
owner = replaceOnce(owner, '  workIdentity = fs.lstatSync(work);\n  const positive =', `  workIdentity = fs.lstatSync(work);
  assert.equal(main.positiveWork, path.join(work, 'positive'));
  assert.deepEqual(main.fixturePreparation, ${preparationLiteral});
  const fixture = main.fixturePreparation;
  const fixtureBytes = Buffer.from(fixture.bodyBase64, 'base64');
  assert.equal(sha256(fixtureBytes), fixture.bodySha256);
  assert.equal(fixture.directory, path.join(main.positiveWork, 'refusals'));
  fs.mkdirSync(main.positiveWork, { mode: 0o700 });
  fs.mkdirSync(fixture.directory, { mode: 0o700 });
  assert.equal(fs.realpathSync(fixture.directory), fixture.directory);
  for (const name of fixture.regularNames) workPut(path.join(fixture.directory, name), fixtureBytes, fixture.mode);
  const linkCharge = Buffer.byteLength(fixture.symlink.target);
  assert.ok(scratchWrittenBytes + linkCharge <= seal.bounds.tightenedScratchBytes);
  scratchWrittenBytes += linkCharge;
  fs.symlinkSync(fixture.symlink.target, path.join(fixture.directory, fixture.symlink.name));
  fs.linkSync(path.join(fixture.directory, fixture.hardlink.source), path.join(fixture.directory, fixture.hardlink.name));
  assert.equal(fs.readlinkSync(path.join(fixture.directory, fixture.symlink.name)), fixture.symlink.target);
  assert.equal(fs.realpathSync(path.join(fixture.directory, fixture.symlink.name)), path.join(fixture.directory, 'link-target'));
  const fixtureInventory = inventory(fixture.directory);
  event({ kind: 'owned-link-fixtures-precreated-before-positive-child', preparation: fixture, inventory: fixtureInventory });
  const positive =`);
files['owner.mjs'] = owner.replaceAll('remaining-harness-v7-source-data-outcome', 'remaining-harness-v8-source-data-outcome');
let data = files['data-controls.mjs'];
data = replaceOnce(data, '  fs.mkdirSync(work, { mode: 0o700 });', `  assert.equal(fs.realpathSync(work), work);
  assert.ok(fs.lstatSync(work).isDirectory() && !fs.lstatSync(work).isSymbolicLink());
  assert.deepEqual(main.fixturePreparation, ${preparationLiteral});`);
data = replaceOnce(data, '  fs.mkdirSync(refusals);', `  assert.equal(refusals, main.fixturePreparation.directory);
  assert.equal(fs.realpathSync(refusals), refusals);
  assert.ok(fs.lstatSync(refusals).isDirectory() && !fs.lstatSync(refusals).isSymbolicLink());`);
data = replaceOnce(data,
  "  fs.symlinkSync(path.join(moved, `${input.installedPrefix}${input.variants[0]}${input.suffix}`), path.join(refusals, 'symlink'));\n  put(path.join(refusals, 'alias-source'), bodies[0]);\n  fs.linkSync(path.join(refusals, 'alias-source'), path.join(refusals, 'alias'));",
  `  assert.ok(fs.lstatSync(path.join(refusals, 'symlink')).isSymbolicLink());
  assert.equal(fs.readlinkSync(path.join(refusals, 'symlink')), 'link-target');
  assert.equal(fs.realpathSync(path.join(refusals, 'symlink')), path.join(refusals, 'link-target'));
  authenticate(path.join(refusals, 'link-target'), bodies[0], input.mode);
  assert.deepEqual(fs.readFileSync(path.join(refusals, 'alias-source')), bodies[0]);
  const aliasSource = fs.lstatSync(path.join(refusals, 'alias-source'));
  const alias = fs.lstatSync(path.join(refusals, 'alias'));
  assert.ok(aliasSource.isFile() && !aliasSource.isSymbolicLink());
  assert.ok(alias.isFile() && !alias.isSymbolicLink());
  assert.equal(aliasSource.mode & 0o777, input.mode);
  assert.equal(alias.mode & 0o777, input.mode);
  assert.equal(aliasSource.nlink, 2);
  assert.equal(alias.nlink, 2);
  assert.equal(aliasSource.dev, alias.dev);
  assert.equal(aliasSource.ino, alias.ino);`);
files['data-controls.mjs'] = data;
assert.equal(/fs\.(?:symlink|link)Sync/.test(data), false);
for (const name of ['child.mjs', 'fixture-data.mjs', 'primitives.mjs']) {
  assert.equal(/fs\.(?:symlink|link|chmod|chown|mkdtemp)Sync/.test(files[name]), false);
}
assert.equal(data.slice(data.indexOf('  const refusalBefore =')), fs.readFileSync(path.join(oldRoot, 'data-controls.mjs'), 'utf8').slice(fs.readFileSync(path.join(oldRoot, 'data-controls.mjs'), 'utf8').indexOf('  const refusalBefore =')));
function remap(value) {
  if (typeof value === 'string') return value.replaceAll(oldRoot, newRoot);
  if (Array.isArray(value)) return value.map(remap);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remap(entry)]));
  return value;
}
const seal = structuredClone(oldSeal);
for (const key of ['launch', 'discovery', 'mainTemplate', 'boundRunRoot']) seal[key] = remap(seal[key]);
seal.schema = 'remaining-harness-v8-parent-created-links-preseal';
seal.authorization = 'ROOT versioned fixture-only repair; one six-control/four-DATA plus separate startup-open-refusal qualification; no product admission';
seal.preparationEnvelope = { classification: 'new source preparation, separate from one subsequent qualification epoch; historical v7 counts unchanged' };
seal.mainTemplate.fixturePreparation = preparation;
seal.files = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { bytes: Buffer.byteLength(text), mode: 0o644, sha256: digest(text) }]));
for (const name of ['SYMLINK-REPORT.md', 'symlink-run.mjs', 'SYMLINK-PRESEAL.json']) {
  const filename = `tests/commands/apply-patch-capture-review-20260828/${name}`;
  const bytes = fs.readFileSync(filename);
  seal.sourceBindings[filename] = { bytes: bytes.length, mode: fs.lstatSync(filename).mode & 0o777, sha256: digest(bytes) };
}
for (const name of ['owner.mjs', 'data-controls.mjs']) seal.sourceBindings[`${oldBase}/recipe/${name}`] = oldSeal.files[name];
seal.sourceBindings[`${oldBase}/recipe/DISCOVERY-PRESEAL.json`] = { bytes: fs.statSync(path.join(oldRoot, 'DISCOVERY-PRESEAL.json')).size, mode: 0o644, sha256: 'f83d5102f3ac3c8d3d2a3645cb81b4c9291ccab5cf8a0da7c7ba4363d0fa5530' };
files['DISCOVERY-PRESEAL.json'] = JSON.stringify(seal, null, 2) + '\n';
const preparationAudit = {
  schema: 'v8-source-preparation-audit',
  predecessorCommit: '90311c10a0a95f8de7c889b2bd8395d4e95a1d37',
  predecessorFailureEvidence: '071f8fdb',
  referenceEvidence: ['4934900a', '9c4dad3091845987d538f4cbb67cd7060268444e'],
  links: preparation,
  noChildLinkCreation: true,
  unchangedAssertionTailFrom: 'const refusalBefore =',
  unchangedControls: seal.mainTemplate.controls,
  unchangedData: seal.mainTemplate.dataChecks,
  permissionChange: 'only exact owned versioned root/entry path substitution; no additional child capabilities',
  files: seal.files,
  presealSha256: digest(files['DISCOVERY-PRESEAL.json']),
  allReachableFixturePreparation: {
    owner: 'exact-root mkdir/write/open; exclusively creates two owned regular fixtures, one relative symlink, one hardlink; direct serialized Git objects; cleanup after exact child close',
    child: 'startup intentional open denial; deliberate spawnSync permission negative control; no symlink/hardlink creation',
    data: 'bounded mkdir/write/rename under provided root; R01/R02 previously reached; link authentication/read-only refusal tests; no remaining link creation',
    primitives: 'read-only lstat/open/read/readdir/readlink/hash',
    fixtureData: 'pure in-memory fixture deltas/counters/fake provider',
  },
};
files['PREPARATION-AUDIT.json'] = JSON.stringify(preparationAudit, null, 2) + '\n';
const additions = Object.entries(files).map(([name, text]) => {
  const filename = name === 'PREPARATION-AUDIT.json' ? `${newBase}/${name}` : `${newBase}/recipe/${name}`;
  assert.equal(fs.existsSync(filename), false, 'never overwrite an existing successor');
  assert.ok(text.endsWith('\n'));
  return `*** Add File: ${filename}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}\n`;
});
process.stdout.write('*** Begin Patch\n' + additions.join('') + '*** End Patch\n');
