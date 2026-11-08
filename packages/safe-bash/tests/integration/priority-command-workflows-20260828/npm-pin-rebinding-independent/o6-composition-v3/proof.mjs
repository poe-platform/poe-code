import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

export const root = '/Users/kjopek/Workspace/safe-bash';
export const scope = 'tests/integration/priority-command-workflows-20260828/npm-pin-rebinding-independent/o6-composition-v3';
export const caps = Object.freeze({ wallMs: 600000, sourceMs: 360000, childMs: 60000, children: 16, captureBytes: 33554432, workBytes: 134217728 });
export const tool = Object.freeze({ path: '/Library/Developer/CommandLineTools/usr/bin/git', mode: 493, bytes: 7604272, sha256: 'be4afb2b003904725826250de9fb76567bbacf82323457b5a1ec26706b66bcae' });
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const gitHash = (kind, bytes) => crypto.createHash('sha1').update(Buffer.from(`${kind} ${bytes.length}\0`)).update(bytes).digest('hex');
const canonical = value => Buffer.from(JSON.stringify(value));
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`, 'u').test(value);
const safePath = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !/[\0\r\n:]/u.test(value) && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');

function requireData(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value, keys) {
  requireData(value !== null && typeof value === 'object' && !Array.isArray(value), 'record type');
  const actual = Reflect.ownKeys(value);
  requireData(actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key)), 'exact record keys');
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireData(descriptor && Object.hasOwn(descriptor, 'value'), 'own data only');
    output[key] = descriptor.value;
  }
  return output;
}

function finiteRows(value, count) {
  requireData(Array.isArray(value) && value.length === count && Reflect.ownKeys(value).length === count + 1, 'finite dense row count');
  return Array.from({ length: count }, (unusedValue, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireData(descriptor && Object.hasOwn(descriptor, 'value'), 'row hole/accessor');
    return descriptor.value;
  });
}

function validateStored(value) {
  const row = record(value, ['role', 'expression', 'kind', 'oid', 'bytes', 'sha256', 'revision', 'path', 'purpose']);
  requireData(['STORED_DOCUMENT', 'STORED_COMMIT', 'STORED_ANCESTOR_TREE', 'STORED_SELECTED_BLOB'].includes(row.role), 'unknown stored role');
  requireData(hex(row.revision, 40) && hex(row.oid, 40) && hex(row.sha256, 64), 'nonnull stored identity');
  requireData(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= caps.captureBytes, 'stored byte length');
  requireData(typeof row.purpose === 'string' && row.purpose.length > 0, 'stored purpose');
  if (row.role === 'STORED_COMMIT') {
    requireData(row.kind === 'commit' && row.path === null && row.expression === row.revision && row.oid === row.revision, 'commit role mismatch');
  } else {
    requireData(row.path === '' ? row.role === 'STORED_ANCESTOR_TREE' : safePath(row.path), 'stored path');
    requireData(row.expression === `${row.revision}:${row.path}`, 'stored expression mismatch');
    requireData(row.kind === (row.role === 'STORED_ANCESTOR_TREE' ? 'tree' : 'blob'), 'stored kind mismatch');
  }
  return row;
}

function parseBatch(bytes, requests) {
  const output = new Map();
  let offset = 0;
  for (const request of requests) {
    const end = bytes.indexOf(10, offset);
    requireData(end >= offset, 'missing Git header');
    const header = bytes.subarray(offset, end).toString('ascii');
    const match = /^([0-9a-f]{40}) (blob|tree|commit) ([0-9]+)$/u.exec(header);
    requireData(match !== null, `missing/malformed metadata for ${request.expression}`);
    const size = Number(match[3]);
    requireData(Number.isSafeInteger(size) && size >= 0 && end + size + 1 < bytes.length, 'Git frame length');
    const body = bytes.subarray(end + 1, end + size + 1);
    requireData(bytes[end + size + 1] === 10 && gitHash(match[2], body) === match[1], 'Git object framing/hash');
    requireData(match[2] === request.kind && match[1] === request.oid && size === request.bytes && sha256(body) === request.sha256, `bound metadata mismatch: ${request.expression}`);
    output.set(request.expression, { ...request, body });
    offset = end + size + 2;
  }
  requireData(offset === bytes.length, 'unexpected trailing Git frames');
  return output;
}

function serializeTree(entries) {
  const ordered = [...entries].sort((left, right) => Buffer.compare(Buffer.concat([left.name, Buffer.from(left.mode === '40000' ? '/' : '')]), Buffer.concat([right.name, Buffer.from(right.mode === '40000' ? '/' : '')])));
  return Buffer.concat(ordered.map(entry => Buffer.concat([Buffer.from(`${entry.mode} `), entry.name, Buffer.from([0]), Buffer.from(entry.oid, 'hex')])));
}

function parseTree(bytes) {
  const entries = [];
  const names = new Set();
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const nul = bytes.indexOf(0, space + 1);
    requireData(space > offset && nul > space + 1 && nul + 21 <= bytes.length, 'tree frame');
    const mode = bytes.subarray(offset, space).toString('ascii');
    const name = Buffer.from(bytes.subarray(space + 1, nul));
    const nameHex = name.toString('hex');
    requireData(['40000', '100644', '100755', '120000', '160000'].includes(mode) && !name.includes(47) && !names.has(nameHex), 'tree mode/name');
    names.add(nameHex);
    entries.push({ mode, name, oid: bytes.subarray(nul + 1, nul + 21).toString('hex') });
    offset = nul + 21;
  }
  requireData(serializeTree(entries).equals(bytes), 'noncanonical Git tree');
  return entries;
}

function lookup(trees, rootOid, selectedPath) {
  let oid = rootOid;
  const components = selectedPath.split('/');
  const trace = [];
  for (const [index, component] of components.entries()) {
    const entries = trees.get(oid);
    requireData(entries !== undefined, `unbound ancestor tree ${oid} for ${selectedPath}`);
    const entry = entries.find(candidate => candidate.name.equals(Buffer.from(component)));
    requireData(entry !== undefined, `missing selected member ${selectedPath}`);
    trace.push({ tree: oid, component, mode: entry.mode, oid: entry.oid });
    if (index !== components.length - 1) requireData(entry.mode === '40000', 'non-tree ancestor');
    oid = entry.oid;
  }
  return { ...trace.at(-1), trace };
}

function replace(trees, rootOid, components, replacement, generated, directory = '') {
  const entries = trees.get(rootOid);
  requireData(entries !== undefined, `missing replacement parent ${rootOid}`);
  const index = entries.findIndex(entry => entry.name.equals(Buffer.from(components[0])));
  requireData(index >= 0, 'overlay cannot create an undeclared member');
  const previous = entries[index];
  const next = entries.map(entry => ({ ...entry }));
  if (components.length === 1) {
    requireData(previous.mode === replacement.mode, 'overlay mode change');
    next[index] = { ...previous, oid: replacement.blob };
  } else {
    requireData(previous.mode === '40000', 'overlay ancestor mode');
    const childDirectory = directory ? `${directory}/${components[0]}` : components[0];
    next[index] = { ...previous, oid: replace(trees, previous.oid, components.slice(1), replacement, generated, childDirectory) };
  }
  const bytes = serializeTree(next);
  const oid = gitHash('tree', bytes);
  trees.set(oid, next);
  generated.push({ directory, previousOid: rootOid, oid, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64'), changedChildNameBase64: previous.name.toString('base64') });
  return oid;
}

export class Session {
  constructor(origin, wall, sealed) {
    this.origin = origin;
    this.wall = wall;
    this.sealed = sealed;
    this.calls = [];
    this.external = [];
    this.captureBytes = 0;
    this.failures = [];
    this.unsafe = false;
    this.directory = path.join(root, scope);
    this.adminLog = '/tmp/npm-pin-o6-v3-final.txt';
    fs.mkdirSync(path.join(this.directory, 'raw'));
    this.write('raw/ORIGIN.json', { originMonotonicMs: origin, wall, caps });
    this.guard();
    fs.writeFileSync(this.adminLog, JSON.stringify({ event: 'O6-origin', wall, originMonotonicMs: origin, caps }) + '\n', { flag: 'wx' });
  }
  elapsed() { return performance.now() - this.origin; }
  inventory() {
    const rows = [];
    const visit = directory => {
      for (const name of fs.readdirSync(path.join(this.directory, directory)).sort()) {
        const relative = directory ? `${directory}/${name}` : name;
        const absolute = path.join(this.directory, relative);
        const stat = fs.lstatSync(absolute);
        if (stat.isDirectory()) visit(relative);
        else {
          requireData(stat.isFile(), 'owned evidence must be regular');
          rows.push({ path: relative, mode: stat.mode & 511, bytes: stat.size, sha256: sha256(fs.readFileSync(absolute)) });
        }
      }
    };
    visit('');
    requireData(rows.reduce((total, row) => total + row.bytes, 0) <= caps.workBytes, 'work cap');
    return rows;
  }
  guard() {
    for (const entry of [{ ...tool, absolute: tool.path }, ...this.sealed.map(row => ({ ...row, absolute: path.join(this.directory, row.path) }))]) {
      const stat = fs.lstatSync(entry.absolute);
      requireData(stat.isFile() && (stat.mode & 511) === entry.mode && stat.size === entry.bytes && sha256(fs.readFileSync(entry.absolute)) === entry.sha256, `integrity ${entry.absolute}`);
    }
  }
  write(name, value) {
    requireData(safePath(name), 'evidence path');
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
    requireData(this.inventory().reduce((total, row) => total + row.bytes, 0) + bytes.length <= caps.workBytes, 'work write cap');
    fs.writeFileSync(path.join(this.directory, name), bytes, { flag: 'wx' });
  }
  git(args, input = Buffer.alloc(0), administrative = false) {
    requireData(!this.unsafe || administrative, 'unsafe proof stop');
    requireData(this.elapsed() < (administrative ? caps.wallMs : caps.sourceMs), 'fixed global deadline');
    requireData(this.calls.length + this.external.length < caps.children, 'child cap');
    requireData(administrative ? ['diff', 'add', 'commit', 'status'].includes(args[0]) : args.length === 2 && args[0] === 'cat-file' && args[1] === '--batch', 'command role');
    this.guard();
    const ordinal = this.calls.length + this.external.length + 1;
    const prefix = `raw/${String(ordinal).padStart(2, '0')}`;
    if (!administrative) this.write(`${prefix}.stdin`, input);
    const argv = ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'user.name=Codex', '-c', 'user.email=codex@openai.com', ...args];
    const started = performance.now();
    const child = spawnSync(tool.path, argv, { cwd: root, input, encoding: null, maxBuffer: Math.floor((caps.captureBytes - this.captureBytes) / 2), timeout: Math.max(1, Math.floor(Math.min(caps.childMs, caps.wallMs - this.elapsed()))), killSignal: 'SIGKILL', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', LC_ALL: 'C' } });
    const stdout = child.stdout || Buffer.alloc(0);
    const stderr = child.stderr || Buffer.alloc(0);
    this.captureBytes += stdout.length + stderr.length;
    const receipt = { ordinal, administrative, argv, pid: child.pid, status: child.status, signal: child.signal, error: child.error ? { code: child.error.code, message: child.error.message } : null, stdoutBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr), elapsedMs: performance.now() - started, parentElapsedMs: this.elapsed() };
    this.calls.push(receipt);
    if (administrative) fs.appendFileSync(this.adminLog, JSON.stringify({ ...receipt, stdoutBase64: stdout.toString('base64'), stderrBase64: stderr.toString('base64') }) + '\n');
    else {
      this.write(`${prefix}.stdout`, stdout);
      this.write(`${prefix}.stderr`, stderr);
      this.write(`${prefix}.json`, receipt);
    }
    this.guard();
    if (child.status !== 0 || child.error || child.signal || !child.pid || this.elapsed() >= caps.wallMs || this.captureBytes > caps.captureBytes) {
      this.unsafe = true;
      this.failures.push({ id: 'CHILD_FAILURE', receipt });
      throw new Error('child failure; no retry');
    }
    return stdout;
  }
  batch(values) {
    const requests = values.map(validateStored);
    requireData(new Set(requests.map(row => row.expression)).size === requests.length, 'duplicate requests');
    const raw = this.git(['cat-file', '--batch'], Buffer.from(requests.map(row => row.expression).join('\n') + '\n'));
    return parseBatch(raw, requests);
  }
  check(id, condition, detail) {
    this.guard();
    const result = { id, pass: Boolean(condition), detail };
    if (!condition) this.failures.push(result);
    return result;
  }
}

export function prove(session, authority) {
  const checks = [];
  const membership = [];
  const generated = [];
  try {
    requireData(authority.schema === 'o6-composition-authority-v3', 'authority schema');
    const target = record(authority.target, ['role', 'commit', 'oid']);
    requireData(target.role === 'DERIVED_ONLY' && target.commit === null && target.oid === '8437e4eda904e1248c25eeef0d9d455b1d251495', 'derived target must not be queried');
    for (const value of authority.historical) {
      const reference = record(value, ['role', 'commit', 'executableAuthority', 'reference', 'purpose']);
      requireData(reference.role === 'HISTORICAL_DATA_ONLY' && reference.commit === null && reference.executableAuthority === false && typeof reference.reference === 'string' && typeof reference.purpose === 'string', 'historical role');
    }
    const inputKeys = ['path', 'revision', 'blob', 'mode', 'bytes', 'sha256', 'role'];
    const inputs = finiteRows(authority.inputs, 268).map(value => record(value, inputKeys));
    requireData(new Set(inputs.map(row => row.path)).size === 268, 'selected path duplicates');
    const origins = new Set(authority.commits.map(row => row.revision));
    requireData(origins.size === 4 && authority.trees.length === 56, 'complete frozen origins/ancestors');
    for (const row of inputs) requireData(safePath(row.path) && origins.has(row.revision) && hex(row.blob, 40) && hex(row.sha256, 64) && row.mode === '100644' && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && typeof row.role === 'string', 'selected input type/identity');
    const first = session.batch([...authority.documents, ...authority.commits]);
    const document = purpose => JSON.parse(first.get(authority.documents.find(row => row.purpose === purpose).expression).body.toString('utf8'));
    const accepted = document('accepted-full-source-catalog');
    const authored = document('author-full-source-catalog');
    const candidate = document('accepted-source-composition-policy');
    const authoredCandidate = document('author-source-composition-policy');
    const prior = document('qualified-prior-results');
    const priorSeal = document('qualified-prior-seal');
    requireData(canonical(accepted.inputs).equals(canonical(authority.inputs)) && canonical(authored.inputs).equals(canonical(authority.inputs)), 'full catalog/input map mismatch');
    requireData(accepted.base === authority.base.commit && accepted.baseTree === authority.base.tree && accepted.composedTree === authority.target.oid, 'catalog base/target');
    requireData(candidate.composition === authority.target.oid && authoredCandidate.composition === authority.target.oid && canonical(candidate.overrides).equals(canonical(authority.overrides)) && canonical(authoredCandidate.overrides).equals(canonical(authority.overrides)), 'exact overlay policy');
    requireData(candidate.package.sha256 === authority.packageSha256, 'package identity context');
    requireData(prior.verdict === 'SPECIFIC_RESIDUALS' && prior.obligations.length === 9 && prior.obligations.find(row => row.id === 'O6').status === 'SPECIFIC_RESIDUAL', 'prior qualification');
    requireData(canonical(prior.obligations.map(row => ({ id: row.id, status: row.status }))).equals(canonical(authority.priorObligationStatuses)), 'qualified prior dispositions changed');
    const priorResultRequest = authority.documents.find(row => row.purpose === 'qualified-prior-results');
    const priorResultPin = priorSeal.files.find(row => row.path === 'RESULTS.json');
    requireData(priorResultPin.sha256 === priorResultRequest.sha256 && priorResultPin.bytes === priorResultRequest.bytes, 'prior result/seal binding');
    const commitRoots = new Map();
    for (const request of authority.commits) {
      const match = /^tree ([0-9a-f]{40})\n/u.exec(first.get(request.expression).body.toString('utf8'));
      requireData(match !== null, 'stored commit tree header');
      const rootTree = authority.trees.find(row => row.revision === request.revision && row.path === '');
      requireData(rootTree !== undefined && rootTree.oid === match[1], 'stored root tree binding');
      commitRoots.set(request.revision, match[1]);
    }
    const expectedOverlays = inputs.filter(row => row.revision !== authority.base.commit);
    requireData(expectedOverlays.length === 5 && canonical(expectedOverlays).equals(canonical(authority.overrides)), 'only five selected overrides');
    const blobRequests = inputs.map(row => ({ role: 'STORED_SELECTED_BLOB', expression: `${row.revision}:${row.path}`, kind: 'blob', oid: row.blob, bytes: row.bytes, sha256: row.sha256, revision: row.revision, path: row.path, purpose: 'O6-selected-source-bytes' }));
    const second = session.batch([...authority.trees, ...blobRequests]);
    const trees = new Map();
    for (const request of authority.trees) {
      const item = second.get(request.expression);
      const entries = parseTree(item.body);
      trees.set(item.oid, entries);
    }
    for (const input of inputs) {
      const origin = lookup(trees, commitRoots.get(input.revision), input.path);
      const body = second.get(`${input.revision}:${input.path}`).body;
      const valid = origin.oid === input.blob && origin.mode === input.mode && body.length === input.bytes && sha256(body) === input.sha256;
      membership.push({ path: input.path, revision: input.revision, oid: input.blob, mode: input.mode, bytes: input.bytes, sha256: input.sha256, originValid: valid, originTrace: origin.trace });
    }
    checks.push(session.check('O6-origin-membership-268', membership.length === 268 && membership.every(row => row.originValid), 'Every selected byte body and path/mode is authenticated in its actual stored origin commit tree.'));
    let composed = commitRoots.get(authority.base.commit);
    requireData(composed === authority.base.tree, 'base root');
    const overlayRoots = [];
    for (const overlay of authority.overrides) {
      composed = replace(trees, composed, overlay.path.split('/'), overlay, generated);
      overlayRoots.push({ path: overlay.path, revision: overlay.revision, root: composed });
    }
    checks.push(session.check('O6-canonical-root', composed === authority.target.oid, 'Canonical Git tree recomposition from stored base plus exactly five replacements; no Git write or derived-object lookup.'));
    for (const row of membership) {
      const final = lookup(trees, composed, row.path);
      row.composedValid = final.oid === row.oid && final.mode === row.mode;
      row.composedTrace = final.trace;
    }
    checks.push(session.check('O6-composed-membership-268', membership.every(row => row.composedValid), 'All268 selected paths resolve in the composed tree; no sparse-witness assumption.'));
    const selectedTreeHash = sha256(canonical(authority.inputs));
    checks.push(session.check('O6-input-table', selectedTreeHash === authority.selectedInputTableSha256, 'Full ordered source catalog identity retained.'));
    const finalBytes = serializeTree(trees.get(composed));
    session.write('COMPOSED-ROOT.tree.data', finalBytes);
    session.write('GENERATED-TREES.json', { role: 'DERIVED_CANONICAL_PREIMAGES_NOT_STORED_GIT_OBJECTS', overlayRoots, generated });
    session.write('MEMBERSHIP-268.json', membership);
    const priorRoles = prior.obligations.filter(row => row.id !== 'O6');
    const result = { schema: 'o6-composition-proof-v3', status: session.failures.length === 0 ? 'O6_COMPLETE' : 'SPECIFIC_RESIDUALS', aggregate: session.failures.length === 0 ? 'PASS_SOURCE_DATA_ONLY' : 'FAIL', rebindAssessment: session.failures.length === 0 ? 'ACCEPTED_REBIND' : 'SPECIFIC_RESIDUALS', assessmentScope: 'O6 new source/data proof plus immutable qualified prior results; not runtime acceptance or GO', sourceInputs: 268, originVerified: membership.filter(row => row.originValid).length, composedVerified: membership.filter(row => row.composedValid).length, unresolved: membership.filter(row => !row.originValid || !row.composedValid).map(row => row.path), base: authority.base, target: authority.target, actualRoot: composed, rootBytes: finalBytes.length, rootSha256: sha256(finalBytes), selectedInputTableSha256: selectedTreeHash, storedCommitCount: authority.commits.length, storedAncestorTreeCount: authority.trees.length, overrides: overlayRoots, checks, priorResultsCommit: authority.priorResultsCommit, inheritedQualifiedObligations: priorRoles, inheritedResultsAreNewPasses: false, previousO6FailureRescored: false, authorTimingQualification: authority.authorTimingQualification, runtimeExecutions: 0, workflowUnrun: 93, roleControlReplays: 0, authorControlReplays: 0, source314Replays: 0, inventory2039Replays: 0, reservationActions: 0, executionGo: false, elapsedAtProofResultMs: session.elapsed() };
    session.write('RESULTS.json', result);
    return result;
  } catch (error) {
    session.unsafe = true;
    session.failures.push({ id: 'O6_PROVENANCE_OR_ALGORITHM_STOP', message: error.message });
    const result = { schema: 'o6-composition-proof-v3', status: 'SPECIFIC_RESIDUALS', aggregate: 'FAIL_STOP', rebindAssessment: 'SPECIFIC_RESIDUALS', checks, failures: session.failures, membershipCompleted: membership.length, retryAuthorized: false, elapsedMs: session.elapsed(), runtimeExecutions: 0, workflowUnrun: 93, executionGo: false };
    session.write('RESULTS.json', result);
    return result;
  }
}
