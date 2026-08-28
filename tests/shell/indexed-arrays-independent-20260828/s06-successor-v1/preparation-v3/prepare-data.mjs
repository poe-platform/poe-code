import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { authenticate, census, digest, tarInventory } from '../../candidate-v1/boundary-app.mjs';
import { supervise } from '../../executor-v1/supervisor.mjs';
import { verifyTool } from '../../candidate-v1/npm-tool.mjs';
import { copyRegularTree, extract, put, unpack, variantTar, verifyTypeTool } from './staging.mjs';
import { prepareCompiledMutation } from './compiled-mutation.mjs';
import { typeCases } from './types.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..'), repository = path.resolve(own, '../../..');
const sealHash = process.argv[2], seal = JSON.parse(authenticate(path.join(here, 'SEAL.json'), sealHash));
const scope = JSON.parse(authenticate(path.join(own, 's06-successor-v1/SCOPE-BINDING-v2.json'), seal.scopeSha256));
const started = performance.now(), runs = [], source = new Map();
let captured = 0, work, unsafe = false;
const result = { kind: 'DATA-physical-closure-and-variants-not-product-execution', sealHash, candidate: scope.product, actualProductExecutions: 0, nativeCalls: 0, runs, sourceProofPremises: [], mutations: [], closures: [] };
function checkRoles() { for (const role of seal.roles) authenticate(path.join(own, role.path), role.sha256); authenticate(scope.tools.node.path, scope.tools.node.sha256); authenticate(seal.git.path, seal.git.sha256); }
try {
  checkRoles(); assert.equal(process.execPath, scope.tools.node.path); assert.equal(process.version, scope.tools.node.version);
  work = fs.mkdtempSync(path.join(here, 'DATA-')); assert.equal(fs.realpathSync(work), work); result.work = work;
  const readGit = async (commit, filename) => {
    assert.ok(runs.length < 280); assert.ok(performance.now() - started < 150000);
    const run = await supervise(seal.git.path, ['show', `${commit}:${filename}`], { cwd: repository, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, timeoutMs: 10000, maxBytes: 16 * 1024 * 1024 });
    captured += run.bytes; assert.ok(captured <= 32 * 1024 * 1024);
    runs.push({ ...run, stdout: undefined, stderr: undefined, stdoutBytes: Buffer.byteLength(run.stdout), stdoutSha256: digest(Buffer.from(run.stdout)), stderrText: run.stderr });
    assert.ok(run.closeObserved && run.groupAbsent && !run.fault && !run.spawnError && !run.signal); assert.equal(run.code, 0);
    return Buffer.from(run.stdout);
  };
  for (const entry of scope.selectedSource) {
    const bytes = await readGit(entry.commit, entry.path); assert.equal(bytes.length, entry.bytes); assert.equal(digest(bytes), entry.sha256);
    put(path.join(work, 'source', entry.path), bytes, parseInt(entry.mode, 8) & 0o777); source.set(entry.path, bytes);
  }
  const capsule = scope.sourceCapsule, encoded = await readGit(capsule.commit, capsule.path); assert.equal(digest(encoded), capsule.encodedSha256);
  const decoded = gunzipSync(Buffer.from(encoded.toString(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }); assert.equal(digest(decoded), capsule.decodedSha256);
  const tar = Buffer.from(JSON.parse(decoded).package.base64, 'base64'); assert.equal(digest(tar), scope.package.sha256); assert.deepEqual(tarInventory(tar), scope.package.inventory);
  const proofs = JSON.parse(fs.readFileSync(path.join(here, 'SOURCE-PROOFS.json')));
  for (const proof of proofs) for (const premise of proof.premises) {
    assert.equal(source.get(premise.path).toString().split(premise.literal).length, premise.occurrences + 1);
    result.sourceProofPremises.push({ id: proof.id, ...premise, sourceSha256: digest(source.get(premise.path)), matched: true, qualification: 'literal data premise authenticated, not a dynamic implementation pass' });
  }
  const members = unpack(tar), mutationFields = ['id','member','originalSha256','originalBytes','mode','replacements','prefix','finalLF','changedSha256','changedBytes'];
  for (const mutation of JSON.parse(fs.readFileSync(path.join(here, 'MUTANTS.json'))).declarations) {
    const bytes = prepareCompiledMutation(members.get(mutation.member).bytes, Object.fromEntries(mutationFields.map(key => [key, mutation[key]])));
    const variant = variantTar(tar, mutation.member, bytes), inventory = tarInventory(variant);
    assert.equal(Object.keys(inventory).length, 862); let changed = 0;
    for (const [name, entry] of Object.entries(scope.package.inventory)) {
      if (name === mutation.member) { assert.equal(inventory[name].sha256, mutation.changedSha256); changed++; }
      else assert.deepEqual(inventory[name], entry);
    }
    assert.equal(changed, 1); result.mutations.push({ id: mutation.id, member: mutation.member, sha256: mutation.changedSha256, variantTarSha256: digest(variant), members: 862, commonMembersByteModeIdentical: 861, finalLF: bytes.at(-1) === 10, actualLoads: 0, kills: 0 });
  }
  const npmEncoded = authenticate(path.join(own, scope.tools.npm.inventoryPath), scope.tools.npm.encodedSha256);
  const npmDecoded = gunzipSync(Buffer.from(npmEncoded.toString(), 'base64')); assert.equal(digest(npmDecoded), scope.tools.npm.decodedSha256);
  const npm = JSON.parse(npmDecoded); verifyTool(npm); result.npm = { root: npm.root, links: scope.tools.npm.links, inventorySha256: digest(npmDecoded), actualNpmExecutions: 0 };
  const app = path.join(work, 'app-data-only'); fs.mkdirSync(app); put(path.join(app, 'package.json'), '{"private":true,"type":"module"}\n');
  extract(tar, path.join(app, 'node_modules/virtual-bash'));
  for (const role of seal.appRoles) put(path.join(app, role.destination), authenticate(path.join(own, role.path), role.sha256));
  for (const row of typeCases) put(path.join(app, 'consumers', `${row.id}.mts`), fs.readFileSync(path.join(here, row.fixture)));
  for (const tool of scope.tools.typeTools) {
    verifyTypeTool(tool);
    copyRegularTree(tool.root, path.join(work, 'tools', 'node_modules', tool.name));
    if (tool.name !== 'typescript') copyRegularTree(tool.root, path.join(app, 'node_modules', tool.name));
  }
  const initialApp = census(app), packageRoot = path.join(app, 'node_modules/virtual-bash');
  assert.deepEqual(Object.fromEntries(Object.entries(census(packageRoot)).filter(([, entry]) => !entry.directory)), scope.package.inventory);
  result.closures.push({ name: 'complete finite consumer DATA app, not built/installed acceptance', root: app, entries: initialApp, rootMode: fs.statSync(app).mode & 0o777, consumerRoot: path.join(app, 'consumers'), packageRoot, parentDirectories: ['.','consumers','node_modules','node_modules/virtual-bash','node_modules/@types','node_modules/@types/node','node_modules/undici-types'].map(name => ({ path: path.resolve(app, name), mode: fs.statSync(path.resolve(app, name)).mode & 0o777 })) });
  for (const directory of ['source','tools']) result.closures.push({ name: directory, root: path.join(work, directory), entries: census(path.join(work, directory)) });
  const total = result.closures.reduce((sum, tree) => sum + Object.values(tree.entries).reduce((bytes, entry) => bytes + (entry.bytes ?? 0), 0), 0); assert.ok(total < 128 * 1024 * 1024); result.physicalBytes = total;
  assert.deepEqual(census(app), initialApp); checkRoles(); result.acceptedPreparation = true;
} catch (reason) { unsafe = true; result.error = String(reason?.stack ?? reason); }
finally {
  result.elapsedMs = performance.now() - started; result.totalCapturedGitBytes = captured;
  result.allMetadataChildrenReaped = runs.every(run => run.closeObserved && run.groupAbsent && !run.fault);
  if (work && result.allMetadataChildrenReaped) {
    result.finalPhysicalCensus = census(work);
    assert.equal(fs.realpathSync(work), work); assert.equal(path.dirname(work), here); assert.ok(path.basename(work).startsWith('DATA-'));
    fs.rmSync(work, { recursive: true }); result.ownedDataRetired = !fs.existsSync(work);
  }
  result.unsafe = unsafe || !result.allMetadataChildrenReaped || !result.ownedDataRetired || result.elapsedMs > 180000;
  const text = JSON.stringify(result) + '\n'; assert.ok(Buffer.byteLength(text) < 8 * 1024 * 1024);
  assert.equal(fs.existsSync(path.join(here, 'DATA-CAPTURE.json')), false);
  put(path.join(here, 'DATA-CAPTURE.json'), text);
  console.log(JSON.stringify({ sha256: digest(Buffer.from(text)), actualProductExecutions: 0, sourceEntries: source.size, sourcePremises: result.sourceProofPremises.length, exactVariants: result.mutations.length, metadataChildren: runs.length, physicalBytes: result.physicalBytes, ownedDataRetired: result.ownedDataRetired, unsafe: result.unsafe, error: result.error }));
  process.exitCode = result.unsafe ? 78 : 0;
}
