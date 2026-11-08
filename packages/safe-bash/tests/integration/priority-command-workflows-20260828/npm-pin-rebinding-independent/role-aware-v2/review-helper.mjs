import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

export const root = '/Users/kjopek/Workspace/safe-bash';
export const scope = 'tests/integration/priority-command-workflows-20260828/npm-pin-rebinding-independent/role-aware-v2';
export const tool = Object.freeze({ path: '/Library/Developer/CommandLineTools/usr/bin/git', mode: 493, bytes: 7604272, sha256: 'be4afb2b003904725826250de9fb76567bbacf82323457b5a1ec26706b66bcae' });
export const caps = Object.freeze({ wallMs: 600000, sourceMs: 480000, childMs: 60000, children: 12, captureBytes: 33554432, workBytes: 134217728 });
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const objectId = (kind, bytes) => crypto.createHash('sha1').update(Buffer.from(`${kind} ${bytes.length}\0`)).update(bytes).digest('hex');
export const canonical = value => Buffer.from(JSON.stringify(value));
export const decodeArchive = bytes => JSON.parse(gunzipSync(Buffer.from(bytes.toString('utf8').trim(), 'base64'), { maxOutputLength: 67108864 }).toString('utf8'));
export const inflateData = (bytes, limit) => gunzipSync(bytes, { maxOutputLength: limit });

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function ownRecord(value, keys) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'record type');
  const actual = Reflect.ownKeys(value);
  requireValue(actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key)), 'record keys');
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor !== undefined && Object.hasOwn(descriptor, 'value'), 'own data only');
    result[key] = descriptor.value;
  }
  return result;
}

function safePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !/[\0\r\n:]/u.test(value) && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}

function hash(value, length) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`, 'u').test(value);
}

export function planArtifact(value, authenticatedBinding) {
  const row = ownRecord(value, ['commit', 'path', 'sealPath', 'sha256', 'bytes', 'storedIdentity']);
  const binding = ownRecord(authenticatedBinding, ['path', 'sha256', 'bytes', 'provenanceSha256']);
  requireValue(safePath(row.path) && typeof row.sealPath === 'string' && row.sealPath.length > 0, 'artifact path');
  requireValue(hash(row.sha256, 64) && Number.isSafeInteger(row.bytes) && row.bytes >= 0, 'artifact content type');
  requireValue(hash(binding.provenanceSha256, 64) && binding.path === row.path && binding.sha256 === row.sha256 && binding.bytes === row.bytes, 'authenticated binding required');
  if (row.storedIdentity === 'verified stored commit:path') {
    requireValue(hash(row.commit, 40), 'stored identity must be nonnull exact commit');
    return Object.freeze({ role: 'stored-commit-path', expression: `${row.commit}:${row.path}`, path: row.path, sha256: row.sha256, bytes: row.bytes, provenanceSha256: binding.provenanceSha256 });
  }
  requireValue(row.storedIdentity === 'unchanged original seal content binding', 'unknown artifact role');
  requireValue(row.commit === null, 'historical identity must remain null');
  return Object.freeze({ role: 'historical-content-only', expression: null, path: row.path, sha256: row.sha256, bytes: row.bytes, provenanceSha256: binding.provenanceSha256 });
}

export function authenticateArtifact(plan, evidence, provenanceSha256) {
  requireValue(provenanceSha256 === plan.provenanceSha256, 'provenance mismatch');
  requireValue(evidence !== null && typeof evidence === 'object' && Buffer.isBuffer(evidence.bytes), 'artifact evidence required');
  requireValue(evidence.kind === 'blob' && evidence.bytes.length === plan.bytes && sha256(evidence.bytes) === plan.sha256, 'artifact content mismatch');
  if (plan.role === 'stored-commit-path') {
    requireValue(evidence.expression === plan.expression && evidence.oid === objectId('blob', evidence.bytes), 'stored proof required');
  } else {
    requireValue(plan.role === 'historical-content-only' && evidence.historicalBindingSha256 === provenanceSha256, 'historical seal proof required');
  }
  return { role: plan.role, path: plan.path, sha256: plan.sha256, authenticated: true, executableAuthorization: false };
}

export function sourceRequest(value) {
  const row = ownRecord(value, ['expression', 'kind', 'oid', 'sha256', 'bytes', 'verified']);
  requireValue(['blob', 'tree', 'commit'].includes(row.kind) && hash(row.oid, 40) && hash(row.sha256, 64), 'source identity types');
  requireValue(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.verified === true, 'source record declaration');
  validateExpression(row.expression);
  requireValue(!row.expression.includes(':') || row.kind === 'blob', 'commit:path kind mismatch');
  return { ...row };
}

export function validateExpression(expression) {
  requireValue(typeof expression === 'string', 'expression type');
  const separator = expression.indexOf(':');
  requireValue(separator === -1 ? hash(expression, 40) : hash(expression.slice(0, separator), 40) && safePath(expression.slice(separator + 1)), 'immutable expression required');
  return expression;
}

export function parseBatch(output, expressions) {
  const records = [];
  let offset = 0;
  for (const expression of expressions) {
    const end = output.indexOf(10, offset);
    requireValue(end >= offset, 'missing Git header');
    const header = output.subarray(offset, end).toString('utf8');
    requireValue(!header.endsWith(' missing'), `unexpected missing metadata: ${expression}`);
    const match = /^([0-9a-f]{40}) (blob|tree|commit) ([0-9]+)$/u.exec(header);
    requireValue(match !== null, 'Git header');
    const size = Number(match[3]);
    requireValue(Number.isSafeInteger(size) && size >= 0 && end + size + 1 < output.length, 'Git length');
    const bytes = output.subarray(end + 1, end + 1 + size);
    requireValue(output[end + 1 + size] === 10 && objectId(match[2], bytes) === match[1], 'Git framing or object hash');
    records.push({ expression, oid: match[1], kind: match[2], size, sha256: sha256(bytes), bytes });
    offset = end + size + 2;
  }
  requireValue(offset === output.length, 'Git trailing bytes');
  return records;
}

export function roleControls() {
  const body = Buffer.from('synthetic role fixture\n');
  const provenance = 'a'.repeat(64);
  const stored = { commit: 'b'.repeat(40), path: 'synthetic/fixture.data', sealPath: 'fixture.data', sha256: sha256(body), bytes: body.length, storedIdentity: 'verified stored commit:path' };
  const historical = { ...stored, commit: null, storedIdentity: 'unchanged original seal content binding' };
  const binding = { path: stored.path, sha256: stored.sha256, bytes: body.length, provenanceSha256: provenance };
  const proof = { expression: `${stored.commit}:${stored.path}`, kind: 'blob', oid: objectId('blob', body), bytes: body };
  const cases = [
    ['stored-valid-plan', true, () => planArtifact(stored, binding).expression === proof.expression],
    ['historical-null-plan', true, () => planArtifact(historical, binding).expression === null],
    ['stored-valid-proof', true, () => authenticateArtifact(planArtifact(stored, binding), proof, provenance).authenticated],
    ['historical-bound-proof', true, () => authenticateArtifact(planArtifact(historical, binding), { kind: 'blob', bytes: body, historicalBindingSha256: provenance }, provenance).authenticated],
    ['malformed-role', false, () => planArtifact({ ...stored, storedIdentity: 'active-ish' }, binding)],
    ['type-mismatch', false, () => planArtifact({ ...stored, bytes: String(body.length) }, binding)],
    ['nonnull-bad-stored-identity', false, () => planArtifact({ ...stored, commit: 'HEAD' }, binding)],
    ['stored-null', false, () => planArtifact({ ...stored, commit: null }, binding)],
    ['historical-nonnull', false, () => planArtifact({ ...historical, commit: stored.commit }, binding)],
    ['active-missing-proof', false, () => authenticateArtifact(planArtifact(stored, binding), null, provenance)],
    ['active-wrong-content', false, () => authenticateArtifact(planArtifact(stored, binding), { ...proof, bytes: Buffer.from('wrong') }, provenance)],
    ['historical-missing-binding', false, () => planArtifact(historical, { ...binding, provenanceSha256: null })]
  ];
  return cases.map(([id, expectedAccept, operation]) => {
    try {
      const value = operation();
      return { id, expectedAccept, accepted: true, returnedTrue: value === true, rejectedBeforeSpawn: false, childStarts: 0, pass: expectedAccept && value === true };
    } catch (error) {
      return { id, expectedAccept, accepted: false, reason: error.message, rejectedBeforeSpawn: true, childStarts: 0, pass: !expectedAccept };
    }
  });
}

export class ReviewSession {
  constructor(origin, wall, sealedFiles) {
    this.origin = origin;
    this.wall = wall;
    this.sealedFiles = sealedFiles;
    this.calls = [];
    this.captureBytes = 0;
    this.unsafe = false;
    this.failures = [];
    this.objects = new Map();
    this.external = [];
    this.output = path.join(root, scope);
    fs.mkdirSync(path.join(this.output, 'raw'), { recursive: false });
    this.write('raw/ORIGIN.json', { wall, monotonicOriginMs: origin, caps });
    this.guard();
  }

  elapsed() { return performance.now() - this.origin; }

  guard() {
    for (const entry of [{ ...tool, absolute: tool.path }, ...this.sealedFiles.map(entry => ({ ...entry, absolute: path.join(this.output, entry.path) }))]) {
      const stat = fs.lstatSync(entry.absolute);
      requireValue(stat.isFile() && (stat.mode & 511) === entry.mode && stat.size === entry.bytes && sha256(fs.readFileSync(entry.absolute)) === entry.sha256, `integrity: ${entry.absolute}`);
    }
  }

  inventory() {
    const rows = [];
    const walk = relative => {
      for (const name of fs.readdirSync(path.join(this.output, relative)).sort()) {
        const child = relative ? `${relative}/${name}` : name;
        const absolute = path.join(this.output, child);
        const stat = fs.lstatSync(absolute);
        if (stat.isDirectory()) walk(child);
        else {
          requireValue(stat.isFile(), 'nonregular owned evidence');
          rows.push({ path: child, kind: 'regular', mode: stat.mode & 511, bytes: stat.size, sha256: sha256(fs.readFileSync(absolute)) });
        }
      }
    };
    walk('');
    requireValue(rows.reduce((total, row) => total + row.bytes, 0) <= caps.workBytes, 'work cap');
    return rows;
  }

  write(name, value) {
    requireValue(safePath(name), 'output path');
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
    const used = this.inventory().reduce((total, row) => total + row.bytes, 0);
    requireValue(used + bytes.length <= caps.workBytes, 'work write cap');
    fs.writeFileSync(path.join(this.output, name), bytes, { flag: 'wx' });
  }

  check(id, condition, detail) {
    this.guard();
    if (!condition) this.failures.push({ id, detail });
    return { id, pass: Boolean(condition), detail };
  }

  git(args, input = Buffer.alloc(0), administrative = false) {
    requireValue(!this.unsafe || administrative, 'unsafe source stop');
    requireValue(this.elapsed() < (administrative ? caps.wallMs : caps.sourceMs), 'single-origin deadline');
    requireValue(this.calls.length + this.external.length < caps.children, 'child cap');
    requireValue(['cat-file', 'ls-tree', 'diff', 'add', 'commit', 'status'].includes(args[0]), 'metadata/admin command only');
    requireValue(administrative === !['cat-file', 'ls-tree'].includes(args[0]), 'command role');
    this.guard();
    const ordinal = this.calls.length + this.external.length + 1;
    const prefix = `raw/${String(ordinal).padStart(2, '0')}`;
    const argv = ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'user.name=Codex', '-c', 'user.email=codex@openai.com', ...args];
    this.write(`${prefix}.stdin`, input);
    const started = performance.now();
    const result = spawnSync(tool.path, argv, { cwd: root, input, encoding: null, maxBuffer: Math.floor((caps.captureBytes - this.captureBytes) / 2), timeout: Math.max(1, Math.floor(Math.min(caps.childMs, caps.wallMs - this.elapsed()))), killSignal: 'SIGKILL', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } });
    const stdout = result.stdout || Buffer.alloc(0);
    const stderr = result.stderr || Buffer.alloc(0);
    this.captureBytes += stdout.length + stderr.length;
    this.write(`${prefix}.stdout`, stdout);
    this.write(`${prefix}.stderr`, stderr);
    const receipt = { ordinal, administrative, argv, pid: result.pid, status: result.status, signal: result.signal, error: result.error ? { code: result.error.code, message: result.error.message } : null, stdoutBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr), elapsedMs: performance.now() - started, parentElapsedMs: this.elapsed() };
    this.calls.push(receipt);
    this.write(`${prefix}.json`, receipt);
    this.guard();
    if (result.status !== 0 || result.signal || result.error || !result.pid || this.elapsed() >= caps.wallMs || this.captureBytes > caps.captureBytes) {
      this.unsafe = true;
      this.failures.push({ id: 'CHILD_FAILURE', receipt });
      throw new Error('child failure; no source retry');
    }
    return stdout;
  }

  batch(expressions) {
    const selected = [...new Set(expressions)].filter(expression => !this.objects.has(expression));
    try {
      selected.forEach(validateExpression);
      if (selected.length === 0) return;
      const raw = this.git(['cat-file', '--batch'], Buffer.from(selected.join('\n') + '\n'));
      for (const record of parseBatch(raw, selected)) this.objects.set(record.expression, record);
    } catch (error) {
      this.unsafe = true;
      this.failures.push({ id: 'BATCH_ADMISSION_OR_PROVENANCE', reason: error.message });
      throw error;
    }
  }

  record(expression) {
    const record = this.objects.get(expression);
    requireValue(record !== undefined, `unread bound data: ${expression}`);
    return record;
  }

  json(expression) { return JSON.parse(this.record(expression).bytes.toString('utf8')); }
}
