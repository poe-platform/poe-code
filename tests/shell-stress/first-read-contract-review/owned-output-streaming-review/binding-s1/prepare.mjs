import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = '/Users/kjopek/Workspace/safe-bash';
const here = dirname(fileURLToPath(import.meta.url));
assert.equal(here, join(root, 'tests/shell-stress/first-read-contract-review/owned-output-streaming-review/binding-s1'));
const review = 'tests/shell-stress/first-read-contract-review';
const frozen = '722c62f8a8e0795dc2c72509cc012a6017217c0d';
const prepared = '9d29cf908efabb7d8d840c62e969ef7bae14bcdb';
const baseline = '3eba797a2f286c80149dff22afbcd177e3ffea08';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBytes = spec => execFileSync('git', ['show', spec], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
const save = async (name, bytes) => {
  const target = resolve(here, name);
  assert.ok(target.startsWith(`${here}/`));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
};
const json = value => `${JSON.stringify(value, null, 2)}\n`;

const binding = {
  S01: ['positive', 'Local pending source explicitly opts in; one source start, operation abort/cleanup and empty success before teardown; stage/caller separately recorded.'],
  S02: ['positive', 'Original mock S3 cat auto-enrollment; one pending source read; honored operation signal, owned source finally and empty success before teardown; mock only.'],
  S03: ['positive', 'Original loopback WebDAV fixture; one server GET, headers flushed/body withheld; owned connection closes and empty success before teardown; no inferred client read count.'],
  S04: ['positive', 'Original authorized loopback curl; one GET, headers flushed/body withheld; owned transfer closes and empty success before teardown.'],
  S05: ['positive', 'Original authorized loopback curl; one GET with headers withheld; request acquisition closes before first body/output and empty success.'],
  S06: ['streaming', 'EOF withheld until server bytes; copied retained reused-buffer upload; explicit operation awaits stalled destination write before advancing sequential producer.'],
  S07: ['borrowedCurl', 'Actual context.invoke curl; externally live parent input owner; stdout-only request/upload closes before owner finalization with zero operation-induced input returns.'],
  S08: ['mixedCurl', 'Actual nested curl preserves required body/header files and writeout; actual parent context independently writes file/stderr; exact bytes/status before owner finalization.'],
  S09: ['treeDrain', 'Registration precedes acquisition; explicit three levels; overlapping registered/finally closes remain pending until cooperative gate opens; no late acquisition/child starts.'],
  S10: ['treeIsolation', 'Child close leaves live parent/sibling with positive file/stderr work and borrowed owner; deliberate parent close then drains sibling.'],
  S11: ['precedence', 'Caller reason 0 retains identity in operation/stage/public rejection; IO-first and abort-first IO profiles remain blocked pending authoritative exact public/pipefail expectations.'],
  S12: ['opaque', 'Nested invocation with opaque read; pre-release settlement/operation/stage separately sampled; no borrowed return; fixture explicitly resolves/rejects later and observes rejection.'],
};

async function capture() {
  const declaration = await readFile('/tmp/safe-bash-owned-output-streaming-prototype-api.txt');
  assert.equal(sha256(declaration), '601adc3e3844aae2b021887e4a096c08c1a1a315baa821a9ce664c19d82c6e14');
  await save('declaration-S1.txt', declaration);
  const provenance = { capturedAt: new Date().toISOString(), sourceIdentity: 'UNBOUND', productExecutions: 0, inputs: [] };
  for (const name of ['FREEZE.md', 'BINDING-CHECKLIST.md', 'case-plan.json', 'PREPARATION.md']) {
    const commit = name === 'FREEZE.md' ? frozen : prepared;
    const bytes = gitBytes(`${commit}:${review}/owned-output-streaming-review/${name}`);
    await save(`frozen/${name}`, bytes);
    provenance.inputs.push({ kind: 'frozen-review', commit, path: `${review}/owned-output-streaming-review/${name}`, archive: `frozen/${name}`, sha256: sha256(bytes), bytes: bytes.length });
  }
  assert.equal(sha256(await readFile(join(here, 'frozen/FREEZE.md'))), '4095cb141a9e7d7e715daa99fc713f8734e00255969e76bdf49e4f82401040ca');
  const manifestBytes = gitBytes(`${baseline}:${review}/evidence/inputs.json`);
  assert.equal(sha256(manifestBytes), 'fe5bec0edc1d55cf574d035c36f7c41b2967cb9e3f43660b980773bec786acf2');
  await save('historical-inputs.json', manifestBytes);
  for (const entry of JSON.parse(manifestBytes).manifest) {
    const originalPath = relative(root, entry.archive);
    assert.ok(originalPath.startsWith(`${review}/preserved/`));
    const bytes = gitBytes(`${baseline}:${originalPath}`);
    assert.equal(sha256(bytes), entry.sha256);
    assert.equal(bytes.length, entry.bytes);
    const archive = `historical/${entry.path}.data`;
    await save(archive, bytes);
    provenance.inputs.push({ kind: 'immutable-historical', commit: baseline, path: originalPath, archive, sha256: entry.sha256, bytes: bytes.length });
  }
  for (const name of ['index.d.ts', 'contracts/command.d.ts', 'contracts/io.d.ts', 'contracts/filesystem.d.ts', 'contracts/errors.d.ts']) {
    const source = `/tmp/safe-bash-owned-output-prototype-Bl8HzL/candidate/dist/${name}`;
    const bytes = await readFile(source);
    const archive = `public-v1/${name}.data`;
    await save(archive, bytes);
    provenance.inputs.push({ kind: 'allowed-v1-public-declaration-only', path: source, archive, sha256: sha256(bytes), bytes: bytes.length });
  }
  provenance.inputs.push({ kind: 'root-forwarded-S1', path: '/tmp/safe-bash-owned-output-streaming-prototype-api.txt', archive: 'declaration-S1.txt', sha256: sha256(declaration), bytes: declaration.length });
  await save('provenance.json', json(provenance));
  const plan = JSON.parse(await readFile(join(here, 'frozen/case-plan.json'), 'utf8'));
  const records = plan.cases.flatMap(entry => entry.parameters.map(parameter => ({
    id: entry.id, parameter, family: entry.family, handler: binding[entry.id][0],
    original: entry.original ?? null, expectation: binding[entry.id][1],
    status: 'UNRUN', bindingStatus: entry.id === 'S11' && parameter !== 'caller-reason-zero' ? 'BLOCKED_PUBLIC_IO_PIPEFAIL_PROFILE' : 'BOUND_TO_S1_PENDING_SOURCE_GATE',
    publicResult: null, operationClosed: null, cooperativeCleanup: null, stageAborted: null,
    callerAborted: null, ownerAliveAtObservation: null, failure: null,
  })));
  assert.equal(plan.cases.length, 12);
  assert.equal(records.length, 20);
  await save('binding-map.json', json({
    classification: 'private frozen binding; preparation only; no acceptance result',
    freezeCommit: frozen, preparationCommit: prepared,
    declarationSha256: sha256(declaration), sourceIdentity: 'UNBOUND',
    authorActualClosed: 'UNBOUND', streamingReadyIdentity: 'UNBOUND',
    logicalCases: 12, positiveCases: 5, controls: 7, parameterizedRecords: 20,
    productExecutions: 0, innerDeadlineMs: 1200, childDeadlineMs: 3000,
    childOutputLimitBytes: 1048576, records,
    separateCohorts: { historicalFive: 'UNRUN', sameSource57Plus9: 'UNBOUND_UNRUN', optionalSealedV2: 'UNRUN_NON_ACCEPTANCE' },
  }));
  await save('execution-inputs.UNBOUND.json', json({
    classification: 'parameter schema only; NOT readiness or execution authorization',
    rootFreshExecutorAuthorization: null, authorActualClosedEvidence: null,
    streamingReady: null, sourceIdentity: null, sourceManifest: null,
    candidateEntry: null, historicalHelper: null, historicalProbe: null,
    historicalFacade: null, tsxImport: null, toolManifest: null,
    sourceTestsBuildPrerequisitesAuthenticated: false,
    publicProfiles: null,
  }));
  console.log(json({ captured: true, declarationSha256: sha256(declaration), inputs: provenance.inputs.length, historicalInputs: JSON.parse(manifestBytes).manifest.length, productExecutions: 0 }));
}

async function checkInputs() {
  const provenance = JSON.parse(await readFile(join(here, 'provenance.json'), 'utf8'));
  for (const entry of provenance.inputs) {
    const bytes = await readFile(join(here, entry.archive));
    assert.equal(sha256(bytes), entry.sha256, entry.archive);
    assert.equal(bytes.length, entry.bytes, entry.archive);
  }
  const mapping = JSON.parse(await readFile(join(here, 'binding-map.json'), 'utf8'));
  const plan = JSON.parse(await readFile(join(here, 'frozen/case-plan.json'), 'utf8'));
  assert.deepEqual(mapping.records.map(entry => `${entry.id}/${entry.parameter}`), plan.cases.flatMap(entry => entry.parameters.map(parameter => `${entry.id}/${parameter}`)));
  assert.equal(new Set(mapping.records.map(entry => entry.id)).size, 12);
  assert.equal(mapping.records.length, 20);
  assert.ok(mapping.records.every(entry => entry.status === 'UNRUN' && entry.publicResult === null));
  assert.equal(mapping.sourceIdentity, 'UNBOUND');
  return mapping;
}

async function bind() {
  const mapping = await checkInputs();
  const observations = JSON.parse(await readFile(join(here, 'expected-observations.json'), 'utf8'));
  assert.deepEqual(observations.records.map(entry => `${entry.id}/${entry.parameter}`), mapping.records.map(entry => `${entry.id}/${entry.parameter}`));
  mapping.records = mapping.records.map((entry, index) => ({ ...entry, ...observations.records[index] }));
  mapping.bindingBlockedRecords = mapping.records.filter(entry => entry.bindingStatus.startsWith('BLOCKED')).length;
  mapping.bindingOnlyRecords = mapping.records.length - mapping.bindingBlockedRecords;
  await save('binding-map.json', json(mapping));
  console.log(json({ logicalCases: 12, records: mapping.records.length, blockedBindings: mapping.bindingBlockedRecords, productExecutions: 0 }));
}

async function seal() {
  await checkInputs();
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name !== 'SHA256SUMS.json') files.push({ path: relative(here, full), sha256: sha256(await readFile(full)) });
    }
  }
  await walk(here);
  files.sort((left, right) => left.path.localeCompare(right.path));
  await save('SHA256SUMS.json', json({ classification: 'binding-content seal, not candidate readiness', sourceIdentity: 'UNBOUND', files }));
  console.log(json({ sealedFiles: files.length, productExecutions: 0 }));
}

async function reconstruct() {
  const mapping = await checkInputs();
  const sealData = JSON.parse(await readFile(join(here, 'SHA256SUMS.json'), 'utf8'));
  for (const entry of sealData.files) assert.equal(sha256(await readFile(join(here, entry.path))), entry.sha256, entry.path);
  const scratch = await mkdtemp('/tmp/safe-bash-owned-output-streaming-binding-');
  await writeFile(join(scratch, 'driver.mjs'), await readFile(join(here, 'driver.mjs.data')));
  await writeFile(join(scratch, 'binding-map.json'), json(mapping));
  await writeFile(join(scratch, 'execution-inputs.UNBOUND.json'), await readFile(join(here, 'execution-inputs.UNBOUND.json')));
  const manifest = JSON.parse(await readFile(join(here, 'historical-inputs.json'), 'utf8'));
  for (const entry of manifest.manifest) {
    const target = join(scratch, 'historical', entry.path);
    assert.ok(target.startsWith(`${scratch}/historical/`));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(here, 'historical', `${entry.path}.data`)));
  }
  console.log(json({ scratch, driver: join(scratch, 'driver.mjs'), reconstructionOnly: true, productExecutions: 0, logicalCases: 12, parameterizedRecords: 20 }));
}

async function syntaxOnly(scratch) {
  assert.match(scratch ?? '', /^\/tmp\/safe-bash-owned-output-streaming-binding-[^/]+$/);
  const driver = join(scratch, 'driver.mjs');
  const driverBytes = await readFile(driver);
  assert.equal(sha256(driverBytes), sha256(await readFile(join(here, 'driver.mjs.data'))));
  const mapping = await checkInputs();
  const checks = [];
  for (const target of [fileURLToPath(import.meta.url), driver]) {
    const stdout = execFileSync(process.execPath, ['--check', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    checks.push({ command: [process.execPath, '--check', target], exitCode: 0, stdout, mode: 'syntax only; file never imported or executed' });
  }
  const verification = {
    classification: 'preparation evidence only; no product runtime', checkedAt: new Date().toISOString(), node: process.version,
    scratch, driverSha256: sha256(driverBytes), mappingSha256: sha256(await readFile(join(here, 'binding-map.json'))),
    checks, inputIntegrity: '29 captured inputs verified including 19 immutable historical archives',
    logicalCases: 12, parameterizedRecords: mapping.records.length,
    blockedBindings: mapping.records.filter(entry => entry.bindingStatus.startsWith('BLOCKED')).length,
    productExecutions: 0, sourceIdentity: 'UNBOUND', allRecords: 'UNRUN',
    candidateImports: 0, authorSourceReads: 0, serversStarted: 0, fixtureChildrenStarted: 0,
    opaqueReadsStarted: 0, backgroundProcessesStarted: 0,
  };
  await save('validation.json', json(verification));
  await writeFile(join(scratch, 'validation.json'), json(verification));
  console.log(json(verification));
}

const action = process.argv[2];
if (action === '--capture') await capture();
else if (action === '--bind') await bind();
else if (action === '--seal') await seal();
else if (action === '--reconstruct') await reconstruct();
else if (action === '--syntax-check') await syntaxOnly(process.argv[3]);
else if (action === '--check') { await checkInputs(); console.log('binding integrity only: 12 logical cases / 20 UNRUN records / 0 product executions'); }
else throw new Error('Preparation only: --capture | --bind | --check | --seal | --reconstruct | --syntax-check TMP; never imports or executes product/driver.');
