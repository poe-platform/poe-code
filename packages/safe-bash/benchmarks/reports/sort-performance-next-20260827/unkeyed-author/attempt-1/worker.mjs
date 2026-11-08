import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const [scratch, variant] = process.argv.slice(2);
const root = pathToFileURL(realpathSync(`${scratch}/${variant}`) + '/').href;
const imports = new Set();
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  assert.ok(result.url.startsWith('node:') || result.url.startsWith(root), result.url);
  imports.add(result.url);
  return result;
} });
const library = await import(root + 'dist/index.js');
const frozen = JSON.parse(readFileSync(`${scratch}/workloads.json`));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const env = { PATH: '/usr/bin:/bin', HOME: '/work', TMPDIR: '/tmp', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
function recorder() {
  const counts = {}, numericUses = new Map(), keyUses = new Map(), origins = new WeakMap();
  let phase = 'collect';
  const count = (key, amount = 1) => { counts[key] = (counts[key] ?? 0) + amount; };
  const distribution = map => {
    const values = [...map.values()].map(value => value.uses).sort((left, right) => left - right);
    return { records: values.length, min: values[0] ?? 0, median: values[Math.floor(values.length / 2)] ?? 0, p95: values[Math.floor(values.length * 0.95)] ?? 0, max: values.at(-1) ?? 0, sum: values.reduce((total, value) => total + value, 0) };
  };
  return {
    count(key, amount = 1) { count(key, amount); if (key === 'keyCompare') count(`keyCompare.${phase}`, amount); },
    phase(value) { phase = value; },
    key(record, view, fields) {
      count('keyExtractions'); count('keyFullLineScanBytes', record.length); count('keyFieldObjects', fields); count('keySelectedBytes', view.length);
      origins.set(view, record);
      const entry = keyUses.get(record) ?? { uses: 0, lineBytes: record.length, selectedBytes: view.length, fields };
      entry.uses++; keyUses.set(record, entry);
    },
    numeric(bytes, whole, fraction) {
      count('numericParses'); count('numericInputCopyBytes', bytes.length); count('normalizedWholeCharacters', whole.length); count('normalizedFractionCharacters', fraction.length);
      const record = origins.get(bytes) ?? bytes;
      const entry = numericUses.get(record) ?? { uses: 0, bytes: bytes.length, wholeCharacters: whole.length, fractionCharacters: fraction.length };
      entry.uses++; numericUses.set(record, entry);
    },
    finish() {
      return { counts, numericUseDistribution: distribution(numericUses), keyUseDistribution: distribution(keyUses), oncePerRecordNumeric: [...numericUses.values()].reduce((sum, value) => ({ bytes: sum.bytes + value.bytes, wholeCharacters: sum.wholeCharacters + value.wholeCharacters, fractionCharacters: sum.fractionCharacters + value.fractionCharacters }), { bytes: 0, wholeCharacters: 0, fractionCharacters: 0 }), oncePerRecordKeys: [...keyUses.values()].reduce((sum, value) => ({ lineBytes: sum.lineBytes + value.lineBytes, selectedBytes: sum.selectedBytes + value.selectedBytes, fields: sum.fields + value.fields }), { lineBytes: 0, selectedBytes: 0, fields: 0 }) };
    },
  };
}
const rows = [];
for (const specimen of frozen.specimens) {
  const fs = library.createMemoryFileSystem();
  await fs.mkdir('/work', { recursive: true }); await fs.mkdir('/tmp', { recursive: true });
  for (const [name, bytes] of Object.entries(specimen.files)) await fs.writeFile('/work/' + name, Buffer.from(bytes, 'base64'));
  if (specimen.borrowed) {
    const original = fs.readStream.bind(fs), input = Buffer.from(specimen.files.input, 'base64');
    fs.readStream = (path, options) => path !== '/work/input' ? original(path, options) : (async function* () {
      const allocation = Buffer.alloc(12, 255), view = allocation.subarray(5, 7);
      for (let offset = 0; offset < input.length; offset += view.length) { view.set(input.subarray(offset, offset + view.length)); yield view; }
      allocation.fill(0);
    })();
  }
  const shell = new library.Shell({ fs, cwd: '/work', env, limits: { maxOutputBytes: 4194304, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 } }).use(library.agentCommands());
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('bounded sort diagnosis')), 5000);
  const profile = variant.endsWith('instrumented') ? recorder() : undefined;
  globalThis.__sortProfile = profile;
  let result;
  try { result = await shell.exec(specimen.script, { stdin: Buffer.from(specimen.stdin, 'base64'), signal: controller.signal }); }
  finally { clearTimeout(deadline); await shell.dispose(); globalThis.__sortProfile = undefined; }
  const effects = {};
  for (const entry of await fs.readdir('/work')) effects[entry.name] = Buffer.from(await fs.readFile('/work/' + entry.name)).toString('base64');
  const observation = { stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), status: result.exitCode, files: effects };
  let equivalent = true;
  try { assert.deepEqual(observation, specimen.expected); } catch { equivalent = false; }
  rows.push({ id: specimen.id, equivalent, observationHash: hash(JSON.stringify(observation)), stdoutBytes: result.stdoutBytes.length, stdoutSha256: hash(result.stdoutBytes), status: result.exitCode, stderr: observation.stderr, effects, ...(!equivalent ? { actual: observation, expected: specimen.expected } : {}), ...(profile ? { profile: profile.finish() } : {}) });
}
console.log(JSON.stringify({ variant, node: process.version, versions: process.versions, rows, imports: [...imports], completed: true, shellsDisposed: rows.length, claims: 'Operation counters only. No timing or peak-allocation claims.' }));
