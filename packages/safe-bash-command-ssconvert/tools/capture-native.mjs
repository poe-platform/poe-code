// Explicit QA capture utility. Never imported by the product or unit tests.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [specPath, outputPath] = process.argv.slice(2);
if (!specPath || !outputPath) throw new Error('Usage: node capture-native.mjs SPEC.json out/CAPTURE.json');
const out = realpathSync('out');
const output = resolve(outputPath);
if (!output.startsWith(out + '/') || !realpathSync(dirname(output)).startsWith(out + '/') && realpathSync(dirname(output)) !== out)
  throw new Error('Captures must be under out');
let root;
function namespace() {
  const result = [];
  const identities = new Map();
  function visit(path) {
    const stat = lstatSync(path);
    const entry = { path: '/' + relative(root, path), mode: stat.mode, nlink: stat.nlink };
    if (stat.isSymbolicLink()) result.push({ ...entry, kind: 'symlink', target: readlinkSync(path) });
    else if (stat.isDirectory()) {
      result.push({ ...entry, kind: 'directory' });
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (stat.isFile()) {
      const identity = stat.dev + ':' + stat.ino;
      const aliasOf = identities.get(identity);
      if (aliasOf === undefined) identities.set(identity, entry.path);
      result.push({ ...entry, kind: 'file', ...(aliasOf === undefined ? {} : { aliasOf }), bytes: [...readFileSync(path)] });
    }
    else throw new Error('Unsupported namespace node: ' + path);
  }
  visit(root);
  return result;
}
const base = {};
let result;
try {
  const specBytes = readFileSync(specPath);
  base.specificationHash = hash(specBytes);
  const spec = JSON.parse(specBytes);
  base.argv0 = Object.hasOwn(spec, 'argv0') ? spec.argv0 : [...Buffer.from(spec.executable)];
  Object.assign(base, { argv: spec.argv, stdin: spec.stdin, env: spec.env });
  const profileBytes = readFileSync(spec.profile);
  base.profileHash = hash(profileBytes);
  const profile = JSON.parse(profileBytes);
  base.sourceHash = hash(readFileSync(spec.archive));
  if (base.sourceHash !== '2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12') throw new Error('Primary source hash mismatch');
  root = realpathSync(spec.cwd);
  if (!root.startsWith(out + '/')) { root = undefined; throw new Error('Native working namespace must be under out'); }
  base.cwd = root;
  base.before = namespace();
  base.inputHash = hash(JSON.stringify({ argv0: base.argv0, argv: spec.argv, stdin: spec.stdin, env: spec.env, cwd: '/', before: base.before }));
  const validBytes = bytes => Array.isArray(bytes) && Array.from(bytes).every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  if (!Array.isArray(spec.argv) || !Array.from(spec.argv).every(validBytes) || !validBytes(spec.stdin)) throw new Error('Invalid argv/stdin byte sequence');
  if (!validBytes(base.argv0) || !base.argv0.length || base.argv0.includes(0)) throw new Error('Invalid argv0 byte sequence');
  const envKeys = new Set();
  if (!Array.isArray(spec.env) || !Array.from(spec.env).every(pair => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string' ||
      !pair[0].length || pair[0].includes('=') || pair[0].includes('\0') || pair[1].includes('\0') || envKeys.has(pair[0])) return false;
    envKeys.add(pair[0]);
    return true;
  })) throw new Error('Invalid environment sequence');
  if (hash(readFileSync(spec.executable)) !== profile.executableHash) throw new Error('Oracle executable profile mismatch');
  if (!Array.isArray(profile.dependencies) || !profile.dependencies.length || !Array.isArray(profile.plugins) || !profile.plugins.length || !profile.locale)
    throw new Error('Uncaptured dependency/plugin/locale profile');
  const members = [...profile.dependencies, ...profile.plugins];
  for (const field of ['settingsSchemas', 'resources', 'buildInputs']) {
    if (!Object.hasOwn(profile, field)) continue;
    if (!Array.isArray(profile[field])) throw new Error('Invalid profile member list: ' + field);
    members.push(...profile[field]);
  }
  if (profile.locale.timezone) members.push(profile.locale.timezone);
  for (const item of members) {
    if (hash(readFileSync(item.path)) !== item.sha256) throw new Error('Profile member hash mismatch: ' + item.path);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const argv = spec.argv.map(bytes => {
    if (bytes.includes(0)) throw new Error('NUL argv cannot be passed to a native process');
    return decoder.decode(new Uint8Array(bytes));
  });
  const execution = spawnSync(spec.executable, argv, { cwd: root, env: Object.fromEntries(spec.env),
    argv0: decoder.decode(new Uint8Array(base.argv0)),
    input: Buffer.from(spec.stdin), maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
  Object.assign(base, { status: execution.status, signal: execution.signal ?? null,
    stdout: execution.stdout === null ? null : [...execution.stdout], stderr: execution.stderr === null ? null : [...execution.stderr] });
  if (execution.error || execution.signal || execution.status === null) throw execution.error ?? new Error('Oracle terminated: ' + execution.signal);
  result = { ...base, state: 'captured', after: namespace() };
} catch (error) {
  result = { ...base, state: 'blocked', reason: String(error), after: null };
  if (root) {
    try { result.after = namespace(); }
    catch (snapshotError) { result.snapshotError = String(snapshotError); }
  }
}
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
process.exitCode = result.state === 'blocked' ? 2 : 0;
