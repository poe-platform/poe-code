import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../../..');
const shipping = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const reviewPath = 'tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/';
const source = 'fe15f1e406fa1039accddec25c696ae7187f6135';
const review = '97c081ec7c7f180889d3640c29d1cd5fd1b10752';
const candidate = 'f5e9fc49b6abb38e180cc9de16c95fced102ff75';
const sha = value => createHash('sha256').update(value).digest('hex');
const normalized = value => sha(JSON.stringify(value));
const read = path => readFileSync(join(root, path));
const json = path => JSON.parse(read(path));
const git = (...args) => execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git', ['--no-replace-objects', ...args], {cwd: root, maxBuffer: 12 * 1024 * 1024});
function bound(path, revision) {
  assert.ok(!path.split('/').some(name => name.toLowerCase() === 'agents.md'));
  const stat = lstatSync(join(root, path)); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 12 * 1024 * 1024);
  const bytes = read(path), committed = git('show', `${revision}:${path}`); assert.deepEqual(bytes, committed);
  const [mode, type, blob] = git('ls-tree', revision, '--', path).toString().trim().split(/\s+/u);
  assert.equal(type, 'blob'); assert.equal(stat.mode & 0o777, Number.parseInt(mode, 8) & 0o777);
  return {path, revision, blob, mode, bytes: bytes.length, sha256: sha(bytes)};
}

async function prepare() {
  assert.deepEqual(process.argv.slice(2), ['--seal-metadata']);
  for (const name of ['PACKET.json', 'ROOT-RECEIPT.template.json', 'VALIDATION.json']) assert.ok(!existsSync(join(directory, name)), 'append-only packet already exists');
  const seal = json(shipping + 'DRIVER.json');
  assert.equal(normalized(seal), '25ee4ded79df9c4fe0a9c8031721887dd7c8e22cb56f10d42b3d415eb30c0527');
  const driverFiles = [bound(shipping + 'DRIVER.json', source)];
  for (const [path, digest] of Object.entries(seal.files)) {
    const entry = bound(shipping + path, source); assert.equal(entry.sha256, digest); driverFiles.push(entry);
  }
  assert.equal(driverFiles.length, 38);
  const unpack = name => JSON.parse(gunzipSync(Buffer.from(read(shipping + name).toString().trim(), 'base64'), {maxOutputLength: 12 * 1024 * 1024}));
  const profile = unpack('PROFILE.json.gz.base64'), external = unpack('EXTERNAL.json.gz.base64');
  const projection = json(shipping + 'INSTRUCTION-PROJECTION.json'), routes = json(shipping + 'TOOL-ROUTES.json'), receipt = json(shipping + 'CANDIDATE.json');
  assert.equal(normalized(profile), '8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f');
  assert.equal(normalized(projection), 'b74e575644c9476b26d96b6863aa2a2078931e73fe3251862d713edd1d7bbefb');
  assert.equal(normalized(routes), 'b440b32475d24642d0fbe5dc222356ac1f209a11597baa07d63d286b06b68ca9');
  assert.equal(receipt.candidate, candidate); assert.equal(profile.candidate, candidate);
  assert.equal(sha(git('cat-file', 'commit', candidate)), receipt.rawCommitSha256);
  assert.equal(git('rev-parse', `${candidate}^{tree}`).toString().trim(), receipt.tree);
  assert.equal(git('rev-parse', `${candidate}:src`).toString().trim(), receipt.sourceTree);
  assert.equal(sha(git('show', `${candidate}:package.json`)), profile.packageManifestSha256);
  for (const change of receipt.changes) assert.equal(sha(git('show', `${candidate}:${change.path}`)), change.afterSha256);
  const proofFiles = ['HANDOFF.md', 'BINDINGS.json', 'QUALIFICATIONS.json', 'PACKET-CHECK.json', 'RESULTS.json'].map(path => bound(reviewPath + path, review));
  const independent = json(reviewPath + 'BINDINGS.json');
  assert.equal(independent.normalizedDriverSha256, normalized(seal));
  assert.equal(independent.profileSha256, normalized(profile));
  assert.equal(independent.projectionSha256, normalized(projection));
  assert.equal(independent.toolRoutesSha256, normalized(routes));
  const {BOUNDS, PHASES, parseArgs} = await import(pathToFileURL(join(root, shipping, 'policy.mjs')));
  const {requireRelease, verifyDriverSeal} = await import(pathToFileURL(join(root, shipping, 'admission.mjs')));
  assert.deepEqual(verifyDriverSeal(), seal);
  const output = '/tmp/full-gate-unified76-f5-fe15-finalroutes-20260828-r1';
  const authorizationFile = '/tmp/unified76-release-f5-fe15-finalroutes-20260828-r1.json';
  assert.ok(!existsSync(output) && !existsSync(authorizationFile));
  const args = ['--candidate', candidate, '--run', output, '--release', authorizationFile, '--committed-archive'];
  assert.equal(parseArgs(args).execute, true);
  assert.throws(() => parseArgs(['--candidate', candidate, '--execute', output, '--release', authorizationFile, '--committed-archive']));
  const template = {action: 'AWAITING_FRESH_ROOT_RELEASE', candidate, driverSha256: normalized(seal), profileSha256: normalized(profile), packageSha256: receipt.expectedPackageSha256, public74: true, public75: true, public76: true, independentDriverAccepted: true, authorization: '', independentEvidence: `${review}:${reviewPath}HANDOFF.md`, qualification: 'Deliberately invalid release template. Root must explicitly authorize this exact packet after its acceptance; prior GO is not inherited.'};
  assert.throws(() => requireRelease(template, seal, profile));
  const node = external.tools.find(tool => tool.origin === '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node'); assert.ok(node);
  const packet = {
    schema: 'unified76-final-routes-release-packet/2', createdAt: new Date().toISOString(), executionAuthorized: false, fullGateLaunched: false,
    product: {candidate, tree: receipt.tree, base: receipt.base, sourceTree: receipt.sourceTree, packageManifestSha256: profile.packageManifestSha256, expectedPackageSha256: receipt.expectedPackageSha256, packageRebuiltHere: false, fixtureReceipt: driverFiles.find(entry => entry.path.endsWith('/CANDIDATE.json'))},
    driver: {source, normalizedSha256: normalized(seal), files: driverFiles},
    independent: {acceptedCommit: review, proofFiles, qualification: 'Root-accepted scoped final routes/fence/A10; fresh14phase PATH compatibility untested. Packet binds the evidence because admission only checks its string is nonblank.'},
    profile: {normalizedSha256: normalized(profile), defaultCount: profile.defaultCount, testConcurrency: profile.testConcurrency, reporter: profile.reporter, scopeEntries: profile.scopeInputs.length, canonicalPaths: profile.canonicalFiles.length, classifiedMts: profile.classifiedMts.length, cleanupInputs: Object.keys(profile.cleanup.files).length, cleanupNormalizedSha256: normalized(profile.cleanup), support: profile.support},
    projection: {normalizedSha256: normalized(projection), candidateEntries: projection.candidateEntries, dependencyEntries: projection.dependencyEntries, logical: projection.logical, physical: projection.physical, opaqueGit: projection.opaqueGit},
    tools: {routesNormalizedSha256: normalized(routes), routes, externalReceipt: json(shipping + 'EXTERNAL-RECEIPT.json'), readableTools: external.tools, dependencyTrees: Object.fromEntries(Object.entries(external.directories).map(([key, entry]) => [key, {origin: entry.origin, entries: entry.entries.length, bytes: entry.bytes, sha256: entry.sha256}])), nativeAssets: external.native.assets, systemBoundary: {host: external.host, sampledOriginalReferences: 11, sandboxReferences: 2, inspectorReferences: 2, qualification: 'Exact tool/reference pairs, not15 unique libraries or file-hash/full-OS attestation. No broader DeveloperTools/unknown/readable-library exception.'}, recheckedHere: false, mandatoryPrelaunchRecheck: true},
    policies: {rootInstructions: 'Exact six metadata-only omissions; never write instruction bodies/alternate snapshots; authenticated opaque Git provenance allowed inertly.', writes: 'Inert outside symlink references permitted; resolved outside/protected writes and physical outside hardlink/directory imports denied. Preopened-FD/TOCTOU/dynamic-image limits retained.', runtime: 'Node24.11.1 qualified gate profile; no product minimum change; permission/explicit TAP/concurrency2 and one audited driver build reused by typing.', sourceIsolation: 'Fixed f5 only; excludes later77/78/helper/Stage2/CD/LET/stack/YQ/XAN/timeout changes and maintained200-entry inventory96ed7733. Historical research data in f5 is not a production overlay.', release: 'No inherited GO. Missing binding/guard/cleanup/unknown route => nonzero HOLD; no permission widening or historical score replacement.'},
    bounds: {...BOUNDS, totalSupervisorMs: BOUNDS.setupTimeoutMs + PHASES.length * BOUNDS.phaseTimeoutMs + BOUNDS.cleanupTimeoutMs, observerRequests: 4096, maintainedConsumerTimeoutMs: 900000, secondaryDiagnosticBytes: 8 * 1024 * 1024, maximumTapCases: 100000},
    phases: PHASES.map(([name, expectedStatus]) => ({name, expectedStatus})),
    launch: {cwd: root, executable: node, script: shipping + 'run.mjs', args, output, physicalOutput: output.replace('/tmp/', '/private/tmp/'), authorizationFile, supervisorOutputPattern: '/private/tmp/unified76-supervisor-*', writeRootPattern: '/private/tmp/unified76-os-write-*', profileNativeEnvironment: profile.environment, qualification: 'Output/authorization paths checked absent now; do not create output before authorized launcher. Rendered fence/inodes bind actual roots at setup; no future envelope invented.'},
    verification: {newArchive: false, instructionBodiesCopied: false, productBuilds: 0, productExecutions: 0, privateReads: false, nativeExecutions: 0, metadataOnly: true},
  };
  assert.equal(packet.profile.classifiedMts, 192); assert.equal(packet.profile.canonicalPaths, 632); assert.equal(packet.profile.cleanupInputs, 256);
  const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  save('PACKET.json', packet); save('ROOT-RECEIPT.template.json', template);
  save('VALIDATION.json', {at: new Date().toISOString(), normalizedPacketSha256: normalized(packet), files: ['PACKET.json', 'ROOT-RECEIPT.template.json', 'prepare.mjs'].map(path => ({path, sha256: sha(readFileSync(join(directory, path)))})), shippingFiles: 38, independentProofFiles: proofFiles.length, fixedFourFixtureHashes: receipt.changes.length, invalidTemplateRejected: true, wrongModeRejected: true, pathsAbsent: true, sourceProductUnchanged: true, fullGateLaunched: false, toolsRehashed: false, qualification: 'Static Git/blob/seal/argument metadata checks only; actual admission/tool verification remains mandatory after new root release.'});
  console.log(JSON.stringify({directory, packetSha256: normalized(packet), fullGateLaunched: false, classifiedMts: packet.profile.classifiedMts}));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare();
