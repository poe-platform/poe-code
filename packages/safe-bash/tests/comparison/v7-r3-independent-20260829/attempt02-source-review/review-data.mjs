import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = '/Users/kjopek/Workspace/safe-bash';
const home = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(home, 'capture');
const preparation = 'tests/comparison/breadth-continuation-20260828/executor-v7-r3/runs/admission-20260829-v7r3-02-preparation';
const wrapper = `${preparation}/wrapper-v3`;
const previous = preparation.replace('-02-preparation', '-01-preparation');
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, label) => { if (!condition) throw Error(label); };
const bindings = [];
const checks = [];
const children = [];
await fs.mkdir(output, { recursive: false, mode: 0o700 });
const primaryLog = await fs.open(path.join(output, 'DATA.json'), 'wx', 0o600);

async function read(relative, cap = 131072) {
  requireThat(/\.(json|md|mjs|data|patch)$/.test(relative), 'TEXT_TYPE');
  const file = path.join(repository, relative);
  const info = await fs.lstat(file);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size <= cap, 'TEXT_ADMISSION');
  const bytes = await fs.readFile(file);
  requireThat(bytes.length === info.size, 'TEXT_SIZE_DRIFT');
  bindings.push({ path: relative, bytes: bytes.length, mode: info.mode & 511, sha256: hash(bytes), gitBlob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') });
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function inventory(commit) {
  const stdout = await fs.open(path.join(output, `${commit}.stdout.raw`), 'wx', 0o600);
  const stderr = await fs.open(path.join(output, `${commit}.stderr.raw`), 'wx', 0o600);
  const args = ['ls-tree', '-r', '-z', '--full-tree', commit, '--', preparation];
  const row = { commit, args, pid: null, exit: null, close: null, stdout: 0, stderr: 0 };
  children.push(row);
  const chunks = [];
  let failure;
  const child = spawn(git, args, { cwd: repository, env: { PATH: '', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  row.pid = child.pid ?? null;
  const timer = setTimeout(() => { failure = Error('METADATA_TIMEOUT'); child.kill('SIGKILL'); }, 10000);
  child.once('exit', (code, signal) => { row.exit = { code, signal }; });
  const close = new Promise(resolve => child.once('close', (code, signal) => { row.close = { code, signal }; resolve(); }));
  child.once('error', error => { failure = error; });
  async function consume(stream, file, name) {
    for await (const bytes of stream) {
      row[name] += bytes.length;
      if (row.stdout + row.stderr > 1048576) { failure = Error('METADATA_CAPTURE_CAP'); child.kill('SIGKILL'); continue; }
      let offset = 0;
      while (offset < bytes.length) {
        const written = await file.write(bytes, offset, bytes.length - offset);
        requireThat(written.bytesWritten > 0, 'CAPTURE_SHORT_WRITE');
        offset += written.bytesWritten;
      }
      if (name === 'stdout') chunks.push(bytes);
    }
  }
  await Promise.all([consume(child.stdout, stdout, 'stdout'), consume(child.stderr, stderr, 'stderr'), close]);
  clearTimeout(timer);
  await stdout.sync(); await stderr.sync(); await stdout.close(); await stderr.close();
  if (failure) throw failure;
  requireThat(row.close.code === 0 && row.close.signal === null && row.stderr === 0, 'METADATA_EXIT');
  const bytes = Buffer.concat(chunks);
  requireThat(bytes.length > 0 && bytes[bytes.length - 1] === 0, 'INVENTORY_TERMINATOR');
  const rows = new Map();
  for (const record of bytes.subarray(0, -1).toString('utf8').split('\0')) {
    const boundary = record.indexOf('\t');
    requireThat(boundary > 0, 'INVENTORY_BOUNDARY');
    const metadata = record.slice(0, boundary).split(' ');
    const name = record.slice(boundary + 1);
    requireThat(metadata.length === 3 && metadata[1] === 'blob' && /^100(644|755)$/.test(metadata[0]) && /^[a-f0-9]{40}$/.test(metadata[2]) && name.startsWith(`${preparation}/`) && !rows.has(name), 'INVENTORY_DOMAIN');
    rows.set(name, { mode: metadata[0], oid: metadata[2] });
  }
  return rows;
}

let status = 'HOLD';
let error = null;
try {
  const sealText = await read(`${wrapper}/REPAIR-SEAL.json`);
  requireThat(hash(Buffer.from(sealText)) === '00f8ad274e9f1b47c842bdc775db6c80d989634525c227a15aac20f18e4fdd46', 'ROOT_SEAL');
  const seal = JSON.parse(sealText);
  const maps = [];
  for (const commit of ['ecb89887b9595227bc2753cbdf42a018d8e36f09', 'e16ab245ff3f1edf6700cba59f3ac7ac546df1a9', '02e60f4dc0a1abf185dd89b180040439c49ce197']) maps.push(await inventory(commit));
  const sourceNames = ['EXECUTION-INTERFACE.json', 'FUTURE-PROFILE.json', 'LITERAL-MAP.json', 'INACTIVE-AUTH.TEMPLATE.json', 'INACTIVE-ROOT-GRANT.TEMPLATE.json', 'HOST-ENVIRONMENT-ALLOWANCE.json', 'host-environment.mjs', 'verify-fds-v3.mjs', 'prepare-captures.mjs', 'FUTURE-LAUNCH.sh.data', 'SOURCE-DIFF.patch'];
  const texts = {};
  for (const name of sourceNames) texts[name] = await read(`${wrapper}/${name}`);
  const owner = await read(`${preparation}/outer-adapter-v2/owner.mjs`);
  const oldOwner = await read(`${previous}/outer-adapter-v1/owner.mjs`);
  requireThat(oldOwner.split("const runId = 'admission-20260829-v7r3-01';").length === 2 && oldOwner.replace("const runId = 'admission-20260829-v7r3-01';", "const runId = 'admission-20260829-v7r3-02';") === owner, 'ONLY_OWNER_LITERAL');
  checks.push('exact-one-owner-literal');
  for (const name of ['capture.mjs', 'controls.mjs', 'stub.mjs']) requireThat(await read(`${preparation}/outer-adapter-v2/${name}`) === await read(`${previous}/outer-adapter-v1/${name}`), `UNCHANGED_${name}`);
  checks.push('three-source-bodies-byte-identical');
  const instance = JSON.parse(await read(`${preparation}/outer-adapter-v2/SEAL.json`));
  for (const row of instance.files) {
    const name = `${preparation}/outer-adapter-v2/${row.path}`;
    await read(name);
    const actual = bindings.at(-1);
    requireThat(actual.bytes === row.bytes && actual.mode === row.mode && actual.sha256 === row.sha256, 'INSTANCE_SEAL');
  }
  const execution = JSON.parse(texts['EXECUTION-INTERFACE.json']);
  const profile = JSON.parse(texts['FUTURE-PROFILE.json']);
  const auth = JSON.parse(texts['INACTIVE-AUTH.TEMPLATE.json']);
  const grant = JSON.parse(texts['INACTIVE-ROOT-GRANT.TEMPLATE.json']);
  requireThat(execution.actualAuthorized === false && profile.actualAuthorized === false && Object.keys(grant.exactThirteenFieldPayload).length === 13 && Object.keys(auth.exactEnvelopeShape).join(',') === 'review,grant', 'INACTIVE_SCHEMA');
  requireThat(JSON.stringify(execution.review) === JSON.stringify(auth.exactEnvelopeShape.review) && execution.review.commit === 'd27fd9145ef27fa1f03e273fe0d4954e7680b147', 'REVIEW_UNCHANGED');
  requireThat(profile.processes.totalPlanned === 67 && profile.processes.administrationSlots === 20 && profile.processes.allOwnedCap === 128 && profile.processes.peak === 5 && profile.elapsed.totalMilliseconds === 5400000, 'PROFILE');
  requireThat(profile.capture.totalBytes === 269484032 && profile.capture.innerBodyBytes + profile.capture.innerCollectorBytes === 268435456 && profile.capture.outerBytes === 524288 && profile.capture.publicationAdminBytes === 524288, 'PARTITION');
  checks.push('inactive-schema-review-resource-profile');
  requireThat(texts['FUTURE-LAUNCH.sh.data'].includes('umask 022\n') && texts['FUTURE-LAUNCH.sh.data'].trimEnd().startsWith('set -eu') && texts['FUTURE-LAUNCH.sh.data'].split('\n').filter(line => line.startsWith("exec -c '")).length === 1, 'EXEC_ROUTE');
  for (const expression of ["path.resolve(home, '../activation/AUTH.json')", "path.resolve(home, '../activation/ROOT-GRANT.json')", "path.join(home, 'actual-capture')"]) requireThat(owner.includes(expression), 'RELATIVE_ROUTE');
  checks.push('source-route-mask-relative-paths');
  for (const suffix of ['activation', 'outer-adapter-v2/actual-capture']) {
    try { await fs.lstat(path.join(repository, preparation, suffix)); throw Error('ATTEMPT02_NAMESPACE_USED'); }
    catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
  }
  checks.push('attempt02-activation-capture-absent-at-review');
  for (const name of ['HANDOFF.md', 'RESULT.json', 'DATA-RESULT.json', 'FINAL-PUBLICATION.json', 'POST-GUARDS.json', 'EVIDENCE-MANIFEST.json']) await read(`${wrapper}/${name}`);
  for (const actual of bindings.filter(row => row.path.startsWith(preparation))) {
    const stored = maps[2].get(actual.path);
    requireThat(stored && stored.oid === actual.gitBlob && parseInt(stored.mode.slice(3), 8) === actual.mode, `COMMITTED_BYTES_${actual.path}`);
    const declared = seal.inputs.find(row => row.path === path.join(repository, actual.path));
    if (declared) requireThat(declared.bytes === actual.bytes && declared.mode === actual.mode && declared.sha256 === actual.sha256 && maps[0].get(actual.path)?.oid === actual.gitBlob, 'PRESEAL_SOURCE');
  }
  checks.push('selected-final-and-preseal-git-blob-mode-authentication');
  status = 'DATA_READY_SOURCE_REVIEW_REQUIRED';
} catch (failure) { error = { name: failure?.name, message: failure?.message }; }
const result = { schema: 'ATTEMPT02_INDEPENDENT_SOURCE_DATA_V1', status, error, checks, bindings, children, actualOwnerLaunches: 0, engineEvaluations: 0, authorControlReruns: 0, gitMetadataChildren: children.length, helperPlusMetadataPeak: 2 };
const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
requireThat(bytes.length < 262144, 'REPORT_CAP');
await primaryLog.writeFile(bytes); await primaryLog.sync(); await primaryLog.close();
process.stdout.write(JSON.stringify({ status, checks: checks.length, gitMetadataChildren: children.length, output: path.join(output, 'DATA.json') }) + '\n');
process.exitCode = status.startsWith('DATA_READY') ? 0 : 1;
