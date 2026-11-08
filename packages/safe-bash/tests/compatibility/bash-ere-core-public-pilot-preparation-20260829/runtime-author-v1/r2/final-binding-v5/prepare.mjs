import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const outerStarted = Number(process.hrtime.bigint() / 1000000n);
const epoch = Date.now();
const issuedAt = new Date(epoch).toISOString();
const latestStart = new Date(epoch + 600000).toISOString();
const expiresAt = new Date(epoch + 1200000).toISOString();
assert(epoch + 1200000 <= Date.parse('2026-08-29T18:15:00.000Z'), 'absolute expiry STOP');
const relative = 'tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1/r2/final-binding-v5';
const directory = path.resolve(relative);
const r2 = path.dirname(directory);
const parent = path.dirname(r2);
const oldDirectory = path.join(r2, 'final-binding-v2');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (filename, cap = 2097152) => { const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap, filename); const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size); return bytes; };
const write = (name, bytes) => { assert(Buffer.byteLength(bytes) <= 2097152); fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx', mode: 0o600 }); };
const oldProfileBytes = read(path.join(r2, 'PROFILE.json'));
const oldProfileHash = 'bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05';
assert.equal(oldProfileBytes.length, 1286043); assert.equal(hash(oldProfileBytes), oldProfileHash);
const oldProfile = JSON.parse(oldProfileBytes);
let checkedFiles = 0;
const bind = row => {
  const stat = fs.lstatSync(row.path); assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.size);
  if (row.mode !== undefined) assert.equal(stat.mode & 0o777, row.mode);
  const descriptor = fs.openSync(row.path, 'r'); const digest = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536);
  try { const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, stat.ino); assert.equal(opened.dev, stat.dev); let count; while ((count = fs.readSync(descriptor, buffer))) digest.update(buffer.subarray(0, count)); } finally { fs.closeSync(descriptor); }
  assert.equal(digest.digest('hex'), row.sha256, row.path); checkedFiles++;
};
for (const row of [...oldProfile.assets, ...oldProfile.tools, oldProfile.archive]) bind(row);
assert.equal(oldProfile.archive.sha256, 'fc559bb3a1bd7db72e959461ce2b733871cde0867095c61fd065021fb498606d');
for (const layout of oldProfile.layouts) {
  const names = []; const walk = directory => { for (const name of fs.readdirSync(directory)) { const filename = path.join(directory, name); const stat = fs.lstatSync(filename); assert(!stat.isSymbolicLink()); if (stat.isDirectory()) walk(filename); else { assert(stat.isFile()); names.push(path.relative(layout.source, filename)); } } };
  walk(layout.source); assert.deepEqual(names.sort(), layout.shipping.map(row => row.path).sort());
  for (const row of layout.shipping) bind({ ...row, path: path.join(layout.source, row.path) });
}
for (const cell of oldProfile.cells) bind(cell.inheritedCell);
const futureRoot = oldProfile.root.replace('FUTURE-PILOT-01', 'FUTURE-PILOT-02'); assert.notEqual(futureRoot, oldProfile.root);
const profile = JSON.parse(oldProfileBytes.toString('utf8').split(oldProfile.root).join(futureRoot));
const admitTarget = (manifest, shipping) => {
  assert.equal(manifest.name, 'virtual-bash'); assert.equal(manifest.type, 'module');
  const target = manifest.exports?.['.']?.import;
  assert.equal(target, './dist/index.js', 'only authenticated root public import target');
  assert(!target.includes('..') && !target.includes('\\') && !target.includes('%'));
  const row = shipping.find(row => row.path === target.slice(2)); assert(row, 'target must be shipping member');
  return { target, row };
};
const entries = {};
const manifests = [];
for (const layout of profile.layouts) {
  const manifestRow = layout.shipping.find(row => row.path === 'package.json'); assert(manifestRow);
  const bytes = read(path.join(layout.source, 'package.json')); assert.equal(bytes.length, manifestRow.size); assert.equal(hash(bytes), manifestRow.sha256);
  const manifest = JSON.parse(bytes); const admitted = admitTarget(manifest, layout.shipping);
  const modulePath = path.join(layout.packageRoot, admitted.target.slice(2));
  const packageUrl = pathToFileURL(layout.packageRoot + path.sep).href;
  assert.equal(new URL(admitted.target, packageUrl).href, pathToFileURL(modulePath).href);
  entries[modulePath] = { manifestPath: path.join(layout.packageRoot, 'package.json'), manifestSize: manifestRow.size, manifestSha256: manifestRow.sha256, importTarget: admitted.target, packageUrl, targetSize: admitted.row.size, targetSha256: admitted.row.sha256 };
  manifests.push({ layout: layout.name, manifestSha256: manifestRow.sha256, importTarget: admitted.target, rootExport: manifest.exports['.'] });
}
const originalCell = read(path.join(parent, 'cell.mjs')).toString('utf8');
const originalBlock = "  const modulePath = require.resolve('virtual-bash');\n  assert.equal(modulePath, spec.modulePath, 'public consumer binding');";
const targetBlock = "  const binding = publicEntries[spec.modulePath]; assert(binding, 'fixed public target member');\n  const manifestBytes = read(binding.manifestPath, binding.manifestSize);\n  assert.equal(manifestBytes.length, binding.manifestSize); assert.equal(hash(manifestBytes), binding.manifestSha256);\n  const manifest = JSON.parse(manifestBytes);\n  assert.equal(manifest.exports?.['.']?.import, binding.importTarget);\n  const publicTarget = new URL(binding.importTarget, binding.packageUrl);\n  assert.equal(publicTarget.href, pathToFileURL(spec.modulePath).href);\n  const targetBytes = read(spec.modulePath, binding.targetSize);\n  assert.equal(targetBytes.length, binding.targetSize); assert.equal(hash(targetBytes), binding.targetSha256);";
const entriesText = `const publicEntries = Object.freeze(${JSON.stringify(entries)});\n`;
assert.equal(originalCell.split(originalBlock).length, 2);
const cellSource = originalCell.replace('const output =', entriesText + 'const output =').replace(originalBlock, targetBlock).replace("await import('virtual-bash')", 'await import(publicTarget.href)');
assert.equal(cellSource.replace(entriesText, '').replace(targetBlock, originalBlock).replace('await import(publicTarget.href)', "await import('virtual-bash')"), originalCell);
assert.throws(() => admitTarget({ name: 'virtual-bash', type: 'module', exports: { '.': { require: './dist/index.js' } } }, [{ path: 'dist/index.js' }]));
assert.throws(() => admitTarget({ name: 'virtual-bash', type: 'module', exports: { '.': { import: '../outside.js' } } }, [{ path: 'outside.js' }]));
assert.throws(() => admitTarget({ name: 'virtual-bash', type: 'module', exports: { '.': { import: './dist/private.js' } } }, [{ path: 'dist/private.js' }]));
assert.throws(() => admitTarget({ name: 'virtual-bash', type: 'module', exports: { '.': { import: './dist/index.js' } } }, []));
const controls = ['exact cell normalization PASS', 'require-only rejection PASS', 'escape rejection PASS', 'private-target rejection PASS', 'nonmember rejection PASS'];
write('cell.mjs', cellSource);
const cellPath = path.join(directory, 'cell.mjs');
for (const rows of [profile.assets, profile.cellAssets]) for (const row of rows) if (row.path === path.join(parent, 'cell.mjs')) { row.path = cellPath; row.size = Buffer.byteLength(cellSource); row.sha256 = hash(cellSource); }
for (const cell of profile.cells) {
  const previous = oldProfile.cells.find(row => row.id === cell.id); assert.deepEqual(cell.definition, previous.definition); assert.deepEqual(cell.inheritedLimits, previous.inheritedLimits);
  const layout = profile.layouts.find(row => row.name === cell.layout);
  assert(entries[path.join(layout.packageRoot, cell.publicEntry)]);
  const spec = { id: cell.id, definition: cell.definition, limits: cell.inheritedLimits, node: profile.node.path, modulePath: path.join(layout.packageRoot, cell.publicEntry), workerPath: path.join(layout.packageRoot, 'dist/commands/regex-execution/ere/transport/worker-entry.js') };
  cell.configSha256 = hash(JSON.stringify(spec) + '\n');
}
profile.budget.logicalBytes += 65536;
assert(profile.budget.logicalBytes <= profile.budget.workingBytes);
const profileBytes = Buffer.from(JSON.stringify(profile, null, 2) + '\n');
assert(profileBytes.length <= 2097152);
assert(3 * (Buffer.byteLength(cellSource) - Buffer.byteLength(originalCell)) + Math.abs(profileBytes.length - oldProfileBytes.length) < 65536);
write('PROFILE.json', profileBytes); const profileHash = hash(profileBytes);
const oldGrantBytes = read(path.join(oldDirectory, 'PENDING-GRANT.json'), 667); const oldGrantHash = '1bef3edb200f9a67c7c27260d33ff850e0d1f85fff0f80022cda2636c6ac3adf'; assert.equal(hash(oldGrantBytes), oldGrantHash);
const oldGrant = JSON.parse(oldGrantBytes);
const grant = { ...oldGrant, profileSha256: profileHash, issuedAt, latestStart, expiresAt, outerStarted };
assert.equal(Object.keys(grant).length, 18); const grantBytes = Buffer.from(JSON.stringify(grant, null, 2) + '\n'); assert.equal(grantBytes.length, 667); const grantHash = hash(grantBytes);
const oldCommand = read(path.join(oldDirectory, 'RESOLVED-COMMAND.txt'), 995).toString('utf8'); const oldCommandHash = '47a843889d997ee006b3f66c03015eb88bc477cee98ad1accb1d47e36851e721'; assert.equal(hash(oldCommand), oldCommandHash);
const substitute = (text, pairs) => pairs.reduce((result, [before, after]) => result.split(before).join(after), text);
const commandPairs = [[oldDirectory, directory], [path.join(r2, 'PROFILE.json'), path.join(directory, 'PROFILE.json')], [oldProfileHash, profileHash], [oldGrantHash, grantHash], [String(oldGrant.outerStarted), String(outerStarted)]];
const command = substitute(oldCommand, commandPairs); const commandHash = hash(command);
assert.equal(substitute(command, commandPairs.map(([before, after]) => [after, before])), oldCommand);
const originalOwner = read(path.join(oldDirectory, 'actual-owner.mjs')).toString('utf8'); assert.equal(hash(originalOwner), '5ae7e2cfc1353c03d2b752110634e421c0ca26caf6c1ff7eae0d102c78f94ea2');
const ownerPairs = [[path.relative(process.cwd(), oldDirectory), relative], [oldGrantHash, grantHash], [oldCommandHash, commandHash], [oldProfileHash, profileHash], [String(oldGrant.outerStarted), String(outerStarted)], ['995', String(Buffer.byteLength(command))]];
const owner = substitute(originalOwner, ownerPairs); assert.equal(substitute(owner, ownerPairs.map(([before, after]) => [after, before])), originalOwner);
const launch = JSON.parse(read(path.join(oldDirectory, 'RESOLVED-LAUNCH.json'))); launch.argv[1] = path.join(directory, 'PROFILE.json'); launch.argv[2] = profileHash; launch.argv[3] = path.join(directory, 'ROOT-GRANT.json'); launch.argv[4] = grantHash; launch.argv[5] = String(outerStarted); launch.activationGrantPath = launch.argv[3]; launch.stdout = path.join(directory, 'actual-outer.stdout'); launch.stderr = path.join(directory, 'actual-outer.stderr');
const unusedSlots = [profile.root, launch.activationGrantPath, launch.stdout, launch.stderr, ...profile.cells.flatMap(cell => [cell.config, cell.stdout, cell.stderr])]; assert.equal(unusedSlots.length, 76); for (const filename of unusedSlots) assert(!fs.existsSync(filename), filename);
for (const name of ['ATTEMPT.json', 'ACTUAL-RECEIPT.json', 'actual-owner.stdout', 'actual-owner.stderr']) assert(!fs.existsSync(path.join(directory, name)));
write('PENDING-GRANT.json', grantBytes); write('RESOLVED-COMMAND.txt', command); write('RESOLVED-LAUNCH.json', JSON.stringify(launch, null, 2) + '\n'); write('actual-owner.mjs', owner);
for (const row of profile.assets) bind(row); assert.equal(hash(read(path.join(directory, 'PROFILE.json'))), profileHash);
const reviewBytes = read(path.resolve('tests/compatibility/bash-ere-core-public-pilot-independent-20260829/runtime-review-r2/RESULT.json')); assert.equal(hash(reviewBytes), 'f5499bbffd18ef06483b26c256bd989d2124abe0fa8afb261d00aa7936becd7b');
const receipt = { status: 'AUTHOR_QUALIFIED_CONDITIONAL_GO_AFTER_COMMIT', authorization: 'ROOT direct public-import-target profile; not Node package-specifier resolution proof; new harness delta AUTHOR-qualified, not independently reviewed', issuedAt, latestStart, expiresAt, latestActualStartExternalCap: '2026-08-29T18:00:00.000Z', outerStarted, profileSha256: profileHash, ownerSha256: hash(owner), ownerSubstitutions: ownerPairs, ownerNormalizedExactly: true, cellSha256: hash(cellSource), cellNormalizedExactly: true, manifests, controls, checkedFiles, unusedSlots, sourcePostguard: true, grant: { bytes: grantBytes.length, sha256: grantHash }, command: { bytes: Buffer.byteLength(command), sha256: commandHash }, conditionalLogicalBytes: profile.budget.logicalBytes, addedHarnessBoundBytes: 65536, oracleChanges: 0, currentWorkers: 0, currentProductImports: 0, currentInstalls: 0, actualCapsUnchanged: true, sourceProducerAndPriorReview: { source: '0f8684d8eea2042cef6ab194ad2f9be165b31698', producer: grant.producerReview, priorPilot: grant.pilotReview, priorPilotReceiptSha256: hash(reviewBytes) }, oldOpaqueFailureCause: 'UNATTRIBUTED; DATA identifies CJS require conditions versus import-only mapping, no claim of recovered exception', clock: { source: 'process.hrtime.bigint milliseconds', sampledUtc: new Date().toISOString(), remainingMs: outerStarted + 1200000 - Number(process.hrtime.bigint() / 1000000n), publicationMs: 180000, noReset: true } };
write('BINDING-RECEIPT.json', JSON.stringify(receipt, null, 2) + '\n');
write('HANDOFF.md', `# AUTHOR-qualified direct public-import-target pilot\n\nROOT conditionally authorizes one actual after preseal commit/checks, not another independent review. Exact pinned exports[\".\"].import target ./dist/index.js, shipping membership and manifest/target bytes are checked before dynamic ESM URL import. This is NOT package-specifier resolution proof. Five DATA controls PASS, no product evaluation in preparation. Cell normalization permits only entry-binding data/block and dynamic import operand. Owner normalization permits only listed bindings/literals. Coordinator/observer/teardown/oracles unchanged.\n\nIssued ${issuedAt}; latest ${latestStart}; expiry ${expiresAt}; external actual-start cap18:00UTC; origin${outerStarted}, never reset. 180sec publication retained. Grant667B ${grantHash}; command${Buffer.byteLength(command)}B ${commandHash}; profile${profileBytes.length}B ${profileHash}; owner ${hash(owner)}.\n\n${checkedFiles} bindings authenticated;76 slots unused. Old5c29ace33 remains opaque R01 nonpass/public entry UNKNOWN; no retroactive cause attribution. Ordinary24 only, broader/private gates OPEN. New logical bound ${profile.budget.logicalBytes}B adds65536B bounded harness delta, below unchanged256MiB actual working cap. Sampled/quiescent, not quota/native peak. ROOT startup, npm, Git exceptions unchanged. Combined20min56roles96MiBcapture512MiBwork; prep <=16roles/one DATA helper/five controls; actual40roles24Workers one-live1200ms-in-thousands including180sec publication. No retry after hard stop.\n`);
assert(Date.now() < Date.parse('2026-08-29T18:00:00.000Z'));
console.log(JSON.stringify({ status: receipt.status, issuedAt, latestStart, expiresAt, outerStarted, grant: receipt.grant, command: receipt.command, profileSha256: profileHash, ownerSha256: hash(owner), controls, checkedFiles, unusedSlots: 76, remainingMs: receipt.clock.remainingMs }, null, 2));
