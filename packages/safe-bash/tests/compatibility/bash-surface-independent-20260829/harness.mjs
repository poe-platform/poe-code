import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const directory = path.dirname(fileURLToPath(import.meta.url));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
export const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
export function requireValue(value, message) { if (!value) throw Error(message); }
export function regular(filename, pin) {
  const before = fs.lstatSync(filename);
  requireValue(before.isFile() && !before.isSymbolicLink() && before.size <= 134217728, 'NONREGULAR_OR_OVERSIZE');
  if (pin.bytes !== undefined) requireValue(before.size === pin.bytes, 'SIZE_DRIFT');
  const bytes = fs.readFileSync(filename);
  requireValue(hash(bytes) === pin.sha256, 'BYTE_DRIFT');
  const after = fs.lstatSync(filename);
  requireValue(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'READ_RACE');
  return bytes;
}
export function loadInputs() {
  const bindings = json('BINDINGS.json');
  const bytes = regular(path.join(directory, 'CASES.original.json'), bindings.cases);
  const cases = JSON.parse(bytes);
  requireValue(cases.expected === null && cases.cases.length === 40, 'EXACT40');
  requireValue(canonical(cases.cases.map(row => row.id)) === canonical(Array.from({ length: 40 }, (_, index) => 'B' + String(index + 1).padStart(2, '0'))), 'CASE_IDS');
  for (const row of cases.cases) requireValue(typeof row.program === 'string' && row.program.indexOf(String.fromCharCode(0)) < 0 && Buffer.byteLength(row.program) < 4096, 'LITERAL_PROGRAM');
  return { bindings, cases, protocol: json('PROTOCOL.json'), qualification: json('QUALIFICATION-CASES.json') };
}
export function nativeEnvironment(caseRoot) {
  return { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: path.join(caseRoot, 'home'), TMPDIR: path.join(caseRoot, 'tmp'), PATH: path.join(caseRoot, 'empty-path') };
}
export function nativeRequest(row, caseRoot, oracle, bounds) {
  requireValue(path.isAbsolute(caseRoot) && !caseRoot.split(path.sep).includes('..'), 'CASE_ROOT');
  return { role: 'native', id: row.id, executable: oracle.path, argv: ['--noprofile', '--norc', '-c', row.program, 'surface-case'], programSha256: hash(Buffer.from(row.program)), environment: nativeEnvironment(caseRoot), cwd: path.join(caseRoot, 'work'), umask: 18, stdinBase64: Buffer.from(row.stdin ?? '').toString('base64'), bounds, filesystemRoot: caseRoot, externalExecAllowed: [], networkAllowed: false };
}
export function validateNativeRequest(actual, expected) { requireValue(canonical(actual) === canonical(expected), 'REQUEST_DRIFT'); }
export function validateReceipt(receipt, request) {
  requireValue(receipt && receipt.id === request.id && receipt.role === request.role, 'ROLE_ID');
  requireValue(receipt.requestSha256 === hash(Buffer.from(canonical(request))), 'REQUEST_BINDING');
  requireValue(receipt.retirement === 'COMPLETE' && receipt.observerComplete === true && receipt.unknownProcesses === 0, 'UNKNOWN_RETIREMENT');
  requireValue(Array.isArray(receipt.processes) && receipt.processes.length >= 1, 'PROCESS_CENSUS');
  requireValue(new Set(receipt.processes.map(row => row.identity)).size === receipt.processes.length, 'DUPLICATE_PROCESS');
  for (const row of receipt.processes) requireValue(typeof row.identity === 'string' && Number.isInteger(row.pid) && row.pid > 0 && row.bornObserved === true && row.exitObserved === true && row.reaped === true, 'UNRETIRED_PROCESS');
  requireValue(receipt.signal === null && receipt.captureOverflow === false && receipt.integrity === 'UNCHANGED' && receipt.safetyStops.length === 0, 'SAFETY_STOP');
  for (const field of ['stdoutBase64', 'stderrBase64']) {
    requireValue(typeof receipt[field] === 'string', 'RAW_STREAM_TYPE');
    const bytes = Buffer.from(receipt[field], 'base64');
    requireValue(bytes.toString('base64') === receipt[field] && bytes.length <= request.bounds.perStreamBytes, 'RAW_CAPTURE');
  }
  requireValue(Number.isInteger(receipt.status) && receipt.status >= 0 && receipt.status <= 255, 'STATUS');
  return receipt;
}
export function compare(native, virtual) {
  const differences = [];
  for (const field of ['stdoutBase64', 'stderrBase64']) if (native[field] !== virtual[field]) differences.push(field);
  if (virtual.kind !== 'result') differences.push('API_REJECTION_VS_NATIVE_STATUS');
  else if (native.status !== virtual.status) differences.push('status');
  if (canonical(native.files) !== canonical(virtual.files)) differences.push('filesystem');
  return { id: native.id, matched: differences.length === 0, differences, native, virtual, normalization: 'NONE', role: 'DIFFERENTIAL_OBSERVATION_NOT_PRECOMPUTED_GOLDEN' };
}
export function validateMembership(rows, ids) {
  requireValue(rows.length === ids.length && new Set(rows.map(row => row.id)).size === ids.length && canonical(rows.map(row => row.id)) === canonical(ids), 'MISSING_DUPLICATE_OR_REORDERED_CASE');
}
export function admitGrant(grant, phase, sealSha256, now) {
  const inputs = loadInputs(), bounds = inputs.protocol.phases[phase];
  requireValue(bounds && grant.schema === 'bash-surface-root-grant-v1' && grant.decision === 'GO' && grant.phase === phase, 'NO_PHASE_GO');
  requireValue(grant.presealSha256 === sealSha256 && grant.root === bounds.root && grant.candidate === inputs.bindings.candidate && grant.packageSha256 === inputs.bindings.package.sha256, 'GRANT_BINDING');
  requireValue(Number.isSafeInteger(grant.deadlineEpochMs) && grant.deadlineEpochMs > now, 'DEADLINE');
  requireValue(canonical(grant.bounds) === canonical(bounds), 'BOUND_DRIFT');
  requireValue(grant.provider?.rootQualified === true && grant.provider.fullClosureManifest && grant.provider.losslessDescendants === true && grant.provider.kernelFence === true, 'UNQUALIFIED_FENCE_OBSERVER_OR_DEPENDENCIES');
  if (phase === 'semantics') requireValue(grant.oracle?.qualifiedProfile === 'GNU Bash 5.3 patch015' && grant.oracle.qualificationReceipt && grant.oracle.rootAcceptance, 'GNU53_ORACLE_UNQUALIFIED');
  else requireValue(grant.oracle?.path === '/bin/bash' && grant.oracle.sha256 === inputs.bindings.binaries[0].sha256 && grant.oracle.qualifiedProfile === 'LOCAL_VERSION_UNKNOWN', 'NO_LOCAL_SUBSTITUTION');
  return inputs;
}
export function snapshot(root) {
  const rows = []; let bytes = 0;
  const walk = (absolute, relative) => {
    for (const name of fs.readdirSync(absolute).sort()) {
      const filename = path.join(absolute, name), rel = relative ? relative + '/' + name : name, stat = fs.lstatSync(filename);
      requireValue(rows.length < 256, 'FILESYSTEM_ENTRY_CAP');
      if (stat.isSymbolicLink()) rows.push({ path: rel, type: 'symlink', target: fs.readlinkSync(filename), mode: stat.mode & 511 });
      else if (stat.isDirectory()) { rows.push({ path: rel, type: 'directory', mode: stat.mode & 511 }); walk(filename, rel); }
      else { requireValue(stat.isFile() && stat.size <= 1048576 && bytes + stat.size <= 4194304, 'FILESYSTEM_BYTE_CAP'); const raw = fs.readFileSync(filename); bytes += raw.length; rows.push({ path: rel, type: 'file', mode: stat.mode & 511, base64: raw.toString('base64') }); }
    }
  };
  walk(root, ''); return rows;
}
export function makePlan(phase) {
  const { protocol, cases, qualification, bindings } = loadInputs();
  const bounds = protocol.phases[phase]; requireValue(bounds, 'PHASE');
  const rows = phase === 'qualification' ? qualification.cases : cases.cases;
  const oracle = phase === 'qualification' ? qualification.oracle : { path: null, qualifiedProfile: 'GNU Bash 5.3 patch015', qualificationReceipt: null };
  return { phase, status: 'UNRUN_NO_GRANT', root: bounds.root, bounds, oracle, requests: rows.map(row => nativeRequest({ ...row, stdin: row.stdin ?? cases.defaultStdin }, path.join(bounds.root, row.id), oracle, bounds)), packageSha256: bindings.package.sha256, blockers: protocol.providerRequirements.missing };
}
