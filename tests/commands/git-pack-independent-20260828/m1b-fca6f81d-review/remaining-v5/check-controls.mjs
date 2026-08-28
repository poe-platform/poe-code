import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const started = performance.now();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = path.join(directory, 'ENV-CONTROLS-01');
await fs.mkdir(output, { mode: 0o700 });
const source = await fs.readFile(path.join(directory, 'admission.mjs'), 'utf8');
if (hash(source) !== '2aa5474b3f589306ff89d416255afc430b7531d918e88088ca507cb7565d156b') throw new Error('CONTROL_SOURCE_HASH');
const observationBytes = await fs.readFile(path.join(directory, 'PREPARATION-01/ENVIRONMENT-OBSERVATION.json'));
if (hash(observationBytes) !== '61aebebc0ec1cc8ac7f0330667fe5e3bbf24e81fa00651ae234796e87d556c18') throw new Error('PROBE_IDENTITY');
const observation = JSON.parse(observationBytes);
if (observation.platform !== 'darwin' || observation.uid !== 501 || observation.keys.length !== 8 || observation.facts.filter(row => !row.declared).length !== 1 || !observation.facts.find(row => row.key === '__CF_USER_TEXT_ENCODING')?.matchesDarwinUidTextEncoding || !observation.facts.filter(row => row.declared).every(row => row.equalsExpected)) throw new Error('OBSERVED_PROFILE');
const start = source.indexOf('  if (process.platform !== "darwin"');
const finish = source.indexOf('  const tools = manifest(', start);
if (start < 0 || finish <= start) throw new Error('GUARD_SPAN');
const guard = new Function('request', 'caseRoot', 'process', source.slice(start, finish));
const request = { toolsRoot: '/controlled/tools' };
const caseRoot = '/controlled/case';
const environment = { PATH: '/controlled/tools/bin', HOME: caseRoot, TMPDIR: caseRoot, TZ: 'UTC', LANG: 'C', LC_ALL: 'C', UV_THREADPOOL_SIZE: '1', __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0' };
const scenarios = [
  ['qualified-host', 'darwin', 501, environment, true],
  ['missing-metadata', 'darwin', 501, Object.fromEntries(Object.entries(environment).filter(([key]) => key !== '__CF_USER_TEXT_ENCODING')), false],
  ['wrong-metadata', 'darwin', 501, { ...environment, __CF_USER_TEXT_ENCODING: '0x1F5:0x1:0x0' }, false],
  ['foreign-platform', 'linux', 501, environment, false],
  ['foreign-uid', 'darwin', 502, environment, false],
  ['unknown-extra', 'darwin', 501, { ...environment, UNKNOWN: 'benign-control' }, false],
  ['wrong-PATH', 'darwin', 501, { ...environment, PATH: '/elsewhere' }, false],
  ['wrong-HOME', 'darwin', 501, { ...environment, HOME: '/elsewhere' }, false],
  ['wrong-TMPDIR', 'darwin', 501, { ...environment, TMPDIR: '/elsewhere' }, false],
  ['NODE_OPTIONS-present', 'darwin', 501, { ...environment, NODE_OPTIONS: '' }, false],
  ['NODE_PATH-present', 'darwin', 501, { ...environment, NODE_PATH: '' }, false],
  ['missing-known-key', 'darwin', 501, Object.fromEntries(Object.entries(environment).filter(([key]) => key !== 'TZ')), false]
];
const results = [];
let bytesWritten = 0;
for (const [id, platform, uid, env, accepted] of scenarios) {
  if (performance.now() - started > 30000) throw new Error('CONTROL_DEADLINE');
  let error = null;
  try { guard(request, caseRoot, { platform, getuid: () => uid, env }); } catch (caught) { error = caught.message; }
  const raw = Buffer.from(JSON.stringify({ id, role: 'SOURCE_BOUND_GUARD_SYNTHETIC_ONLY', error, accepted: error === null }) + '\n');
  bytesWritten += raw.length;
  if (bytesWritten > 65536) throw new Error('CONTROL_CAPTURE');
  await fs.writeFile(path.join(output, id + '.json'), raw, { flag: 'wx', mode: 0o600 });
  results.push({ id, passed: accepted === (error === null) });
}
const result = { status: results.every(row => row.passed) ? 'PASS_SYNTHETIC_ONLY' : 'FAIL', results, compilerLoads: 0, productLoads: 0, childStarts: 0, elapsedMs: performance.now() - started };
await fs.writeFile(path.join(output, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
if (result.status === 'FAIL') process.exitCode = 1;
