import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { claimBytes } from './evidence.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const breadth = path.dirname(root);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export function helperClosure() {
  const visited = new Map();
  function visit(filename) {
    if (visited.has(filename)) return;
    if (!filename.startsWith(`${breadth}/`) || filename.split(path.sep).some(name => name.toUpperCase() === 'AGENTS.MD')) throw new Error('FIXTURE_HELPER_SCOPE');
    const source = fs.readFileSync(filename, 'utf8');
    visited.set(filename, Buffer.from(source));
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g)) visit(path.resolve(path.dirname(filename), match[1]));
  }
  visit(path.join(root, 'worker.mjs'));
  return visited;
}
function identity(filename, base) {
  const bytes = fs.readFileSync(filename), info = fs.lstatSync(filename);
  return { path: path.relative(base, filename), bytes: bytes.length, mode: info.mode & 0o7777, sha256: hash(bytes) };
}
export function buildFixture(caseDirectory, specimen, closure) {
  const repository = path.join(caseDirectory, 'fixture-repository');
  const fixtureBreadth = path.join(repository, 'tests/comparison/breadth');
  const home = path.join(fixtureBreadth, 'executor-v7-r3');
  const output = path.join(home, 'runs', specimen.id.toLowerCase());
  const viewRoot = path.join(output, 'views/baseline-installed');
  const immutable = [];
  const changed = [];
  function put(filename, bytes, mode = 0o644, permanent = true) {
    if (filename.split(path.sep).some(name => name.toUpperCase() === 'AGENTS.MD')) throw new Error('FIXTURE_INSTRUCTION');
    if (!filename.startsWith(`${repository}/`)) throw new Error('FIXTURE_OUTPUT_SCOPE');
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o755 });
    fs.writeFileSync(filename, bytes, { flag: 'wx', mode }); fs.chmodSync(filename, mode);
    if (permanent) immutable.push(filename);
  }
  const sourceEntries = new Map();
  for (const [filename, bytes] of closure) sourceEntries.set(path.relative(breadth, filename), bytes);
  if (specimen.variant === 'reversion') {
    const bytes = fs.readFileSync(path.join(root, '../executor-v7-r2/worker.mjs'));
    changed.push({ path: 'executor-v7-r3/worker.mjs', reason: 'exact immutable old r2 worker reversion', originalSha256: hash(sourceEntries.get('executor-v7-r3/worker.mjs')), fixtureSha256: hash(bytes) });
    sourceEntries.set('executor-v7-r3/worker.mjs', bytes);
  }
  const indexPath = 'benchmarks/node_modules/just-bash/dist/bundle/index.js';
  const stubSources = [
    [indexPath, Buffer.from(fs.readFileSync(path.join(root, 'stub-index.data'), 'utf8').replace('__VARIANT__', specimen.variant))],
    ['benchmarks/node_modules/just-bash/dist/bundle/chunks/chunk-NCUTH6QL.js', fs.readFileSync(path.join(root, 'stub-module.data'))],
    ['benchmarks/node_modules/just-bash/dist/bundle/chunks/chunk-ZBUZKIPX.js', fs.readFileSync(path.join(root, 'stub-workers.data'))],
  ];
  const bootstrapPath = 'executor-v7-r1/bootstrap.mjs';
  const originalBootstrap = sourceEntries.get(bootstrapPath).toString();
  const profileStart = originalBootstrap.indexOf('export const profile =');
  const functionStart = originalBootstrap.indexOf('export function authenticateBootstrap');
  const profile = { name: 'JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1', engine: 'just-bash', layout: 'baseline-installed', consumerPath: 'benchmarks/consumer-v5/consumer.mjs', consumerSha256: 'aa607a53a64e71658fd0c7ca39a6c5e14c311242433c0d41efbccdc15816edd1', files: stubSources.map(([name, bytes]) => [name, bytes.length, hash(bytes)]) };
  const adaptedBootstrap = Buffer.from(`${originalBootstrap.slice(0, profileStart)}export const profile = Object.freeze(${JSON.stringify(profile)});\n\n${originalBootstrap.slice(functionStart)}`);
  if (!adaptedBootstrap.toString().endsWith(originalBootstrap.slice(functionStart))) throw new Error('BOOTSTRAP_BODY_CHANGED');
  sourceEntries.set(bootstrapPath, adaptedBootstrap);
  changed.push({ path: bootstrapPath, reason: 'only profile data changed to authenticated harmless sources; ALL function bodies byte-identical', originalSha256: hash(Buffer.from(originalBootstrap)), fixtureSha256: hash(adaptedBootstrap) });
  const scopes = JSON.parse(fs.readFileSync(path.join(breadth, 'executor-v5/CONSUMER-SCOPES.json')));
  const wrapperBytes = new Map();
  for (const scope of Object.values(scopes.engines)) for (const entry of scope.files) {
    let bytes = fs.readFileSync(path.join(breadth, 'executor-v5', entry.source));
    if (entry.path === profile.consumerPath && specimen.variant === 'wrong-wrapper') bytes = Buffer.concat([bytes, Buffer.from('\n')]);
    if (entry.path === profile.consumerPath && specimen.variant === 'wrong-mode') entry.mode = 0o444;
    entry.bytes = bytes.length; entry.sha256 = hash(bytes);
    wrapperBytes.set(entry.source, bytes);
    put(path.join(fixtureBreadth, 'executor-v5', entry.source), bytes, entry.mode);
  }
  put(path.join(fixtureBreadth, 'executor-v5/CONSUMER-SCOPES.json'), json(scopes));
  for (const [name, bytes] of sourceEntries) if (!immutable.includes(path.join(fixtureBreadth, name))) put(path.join(fixtureBreadth, name), bytes);
  for (const name of ['BINDINGS.json', 'executor-overlay-v2/NAMESPACES.json']) put(path.join(fixtureBreadth, name), fs.readFileSync(path.join(breadth, name)));
  put(path.join(home, 'OPERATION-PLAN.json'), fs.readFileSync(path.join(root, 'OPERATION-PLAN.json')));
  put(path.join(home, 'metadata-stub.mjs'), fs.readFileSync(path.join(root, 'metadata-stub.mjs')), 0o755);
  put(path.join(repository, 'package.json'), json({ private: true, type: 'module', name: 'whole-worker-stub-fixture-not-product' }));
  const entries = [];
  const content = new Map([...stubSources, ['benchmarks/node_modules/just-bash/package.json', json({ name: 'just-bash', version: '0.0.0-harmless-stub', type: 'module', exports: './dist/bundle/index.js' })]]);
  for (const [name, bytes] of content) entries.push({ path: name, bytes: bytes.length, sha256: hash(bytes), mode: 0o444 });
  const wrapperEntries = scopes.engines['just-bash'].files.map(({ source, ...entry }) => entry);
  for (const entry of scopes.engines['just-bash'].files) content.set(entry.path, wrapperBytes.get(entry.source));
  const view = { name: 'baseline-installed', root: viewRoot, files: [...entries, ...wrapperEntries], consumerPath: profile.consumerPath, engine: 'just-bash', oldOrigin: null };
  for (const entry of view.files) put(path.join(viewRoot, entry.path), content.get(entry.path), entry.mode, false);
  const originalProjection = JSON.parse(fs.readFileSync(path.join(breadth, 'executor-v3/PROJECTION.json')));
  const node = originalProjection.tools.find(entry => entry.role === 'node');
  const metadataTool = { ...identity(path.join(home, 'metadata-stub.mjs'), home), role: 'git', path: path.join(home, 'metadata-stub.mjs') };
  const projection = { tools: [node, metadataTool], baseline: { version: '3.4.2', closure: { files: entries }, excluded: [] }, target: { files: [] } };
  put(path.join(fixtureBreadth, 'executor-v3/PROJECTION.json'), json(projection));
  const namespaceEntries = [];
  function census(relative = '') {
    for (const name of fs.readdirSync(path.join(fixtureBreadth, relative)).sort()) {
      const member = path.join(relative, name), info = fs.lstatSync(path.join(fixtureBreadth, member));
      namespaceEntries.push({ path: member, directory: info.isDirectory() });
      if (info.isDirectory() && member !== 'executor-v7-r3/runs') census(member);
    }
  }
  census(); namespaceEntries.push({ path: 'executor-v7-r3/SEAL.json', directory: false });
  const seal = { schema: 'WHOLE_WORKER_HARMLESS_FIXTURE_NOT_ROOT_AUTHORITY', files: immutable.map(filename => identity(filename, home)), namespaces: [{ path: '..', entries: namespaceEntries.sort((left, right) => left.path.localeCompare(right.path)), excludedDescendants: ['executor-v7-r3/runs'] }] };
  const sealBytes = json(seal), recipe = hash(sealBytes);
  put(path.join(home, 'SEAL.json'), sealBytes);
  const review = { role: 'different-reviewer', verdict: 'PREEXECUTION_ACCEPTED', recipeSha256: recipe };
  const reviewBytes = json(review);
  const grant = { role: specimen.variant === 'bad-grant' ? 'not-root' : 'root', phase: 'admission', attempts: 1, runId: specimen.id.toLowerCase(), outputRoot: output, recipeSha256: recipe, reviewSha256: hash(reviewBytes), planSha256: '03463349729bdd298b0ff3ca8c1066c568daad4d5049532e957ce825374ce475', bootstrapProfile: profile.name, reportProtocol: 'BOUNDED_TERMINAL_V3', candidate: '67eab12e315054907ef4ef435c6bbca2f59e0c36', packSha256: '6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06', command: { entry: 'coordinator.mjs', phase: 'admission', runId: specimen.id.toLowerCase(), nodeArgs: ['--unhandled-rejections=strict', '--max-old-space-size=256'] } };
  const grantBytes = json(grant);
  put(path.join(output, 'REVIEW.json'), reviewBytes, 0o644, false);
  put(path.join(output, 'GRANT.json'), grantBytes, 0o644, false);
  const references = { review: { commit: 'a'.repeat(40), path: path.relative(repository, path.join(output, 'REVIEW.json')), sha256: hash(reviewBytes) }, grant: { commit: 'b'.repeat(40), path: path.relative(repository, path.join(output, 'GRANT.json')), sha256: hash(grantBytes) } };
  const mapping = {};
  for (const [role, entry] of Object.entries(references)) mapping[`${entry.commit}:${entry.path}`] = { path: path.relative(home, path.join(output, `${role.toUpperCase()}.json`)), bytes: role === 'review' ? reviewBytes.length : grantBytes.length, sha256: entry.sha256 };
  put(path.join(home, 'runs/METADATA.json'), json(mapping), 0o644, false);
  const plan = JSON.parse(fs.readFileSync(path.join(home, 'OPERATION-PLAN.json'))), operation = plan.admission.find(entry => entry.id === 'probe-3');
  const claim = claimBytes(operation, recipe);
  const permit = { path: path.join(output, 'operation-probe-3.claim'), bytes: claim.length, sha256: hash(claim), mode: 0o444, kind: 'operation-claim', complete: false };
  const config = { kind: 'probe', view, authorization: { repository, phase: 'admission', runId: specimen.id.toLowerCase(), outputRoot: output, ...references }, operationId: operation.id, operationOrdinal: operation.ordinal, launchOrdinal: 3, claimPermit: permit };
  const configBytes = json(config), configPath = path.join(output, 'child-003.json');
  put(configPath, configBytes, 0o644, false);
  const helpers = immutable.filter(filename => filename.endsWith('.mjs')).map(filename => ({ absolute: filename, ...identity(filename, home) }));
  const control = { variant: specimen.variant, viewRoot, driftPath: path.join(viewRoot, indexPath), helpers, viewFiles: view.files.map(entry => ({ ...entry, absolute: path.join(viewRoot, entry.path) })) };
  put(path.join(output, 'CONTROL.json'), json(control), 0o644, false);
  const initial = [];
  function whole(directory) { for (const name of fs.readdirSync(directory).sort()) { const filename = path.join(directory, name), info = fs.lstatSync(filename); if (info.isDirectory()) whole(filename); else initial.push(identity(filename, repository)); } }
  whole(repository);
  return { specimen, repository, home, output, view, recipe, configPath, configSha256: hash(configBytes), metadataTool, helpers, changed, initial, claimPermit: permit, driftPath: control.driftPath, node: node.path, bodySha256: hash(fs.readFileSync(path.join(home, 'worker.mjs'))), noRealAuthority: true };
}
