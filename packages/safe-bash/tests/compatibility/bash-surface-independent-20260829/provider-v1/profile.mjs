import path from 'node:path';
import { createHash } from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireValue(value, message) { if (!value) throw Error(message); }
export function canonical(value) { return Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value); }
export function safePath(value) {
  requireValue(typeof value === 'string' && value.length < 4096 && value.startsWith('/') && path.posix.normalize(value) === value && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 34 || character.charCodeAt(0) === 92), 'UNSAFE_PROFILE_PATH');
  return value;
}
export function requestFor(row, control, tools) {
  requireValue(control.cases.some(item => canonical(item) === canonical(row)), 'UNLISTED_CASE');
  const root = safePath(control.root), caseRoot = root + '/cases/' + row.id;
  return { role: 'harmless-node-fixture', id: row.id, executable: tools.tools.find(item => item.role === 'node').path,
    argv: [root + '/stage/fixture.mjs', row.id, row.mode, caseRoot, root + '/canary'],
    cwd: caseRoot + '/work', filesystemRoot: caseRoot,
    environment: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: caseRoot + '/home', TMPDIR: caseRoot + '/tmp', PATH: caseRoot + '/empty-path' },
    stdinBase64: row.mode === 'stdin' ? Buffer.from([65, 0, 66, 255, 10]).toString('base64') : '',
    forkAllowed: row.extraChildReservation > 0, extraChildReservation: row.extraChildReservation,
    workerStartsAllowed: 0, networkAllowed: false, bounds: control.limits };
}
export function admitRequest(request, control, tools) {
  const row = control.cases.find(item => item.id === request.id);
  requireValue(row && canonical(request) === canonical(requestFor(row, control, tools)), 'UNLISTED_OR_CHANGED_REQUEST');
  return row;
}
export function renderProfile(request, control, tools) {
  admitRequest(request, control, tools);
  const literals = [...new Set([request.executable, ...tools.dependencyFiles.map(item => item.path), ...tools.systemImageLiteralPaths, request.argv[0]])].sort();
  const ancestors = new Set(['/']);
  for (const filename of [...literals, request.filesystemRoot]) { let parent = path.posix.dirname(filename); while (parent !== '/') { ancestors.add(parent); parent = path.posix.dirname(parent); } }
  const literal = value => '(literal ' + JSON.stringify(safePath(value)) + ')';
  const rules = ['(version 1)', '(deny default)', '(deny network*)', '(deny process-fork)', '(deny file-write*)',
    '(allow process-exec ' + literal(request.executable) + ')',
    '(allow file-read-data ' + literals.map(literal).join(' ') + ' (subpath ' + JSON.stringify(request.filesystemRoot) + '))',
    '(allow file-read-metadata ' + [...ancestors, ...literals].sort().map(literal).join(' ') + ' (subpath ' + JSON.stringify(request.filesystemRoot) + '))',
    '(allow file-write* (subpath ' + JSON.stringify(request.filesystemRoot) + '))',
    '(allow sysctl-read ' + tools.sysctlReadNames.map(name => '(sysctl-name ' + JSON.stringify(name) + ')').join(' ') + ')'];
  if (request.forkAllowed) rules.push('(allow process-fork)');
  return rules.join('\n') + '\n';
}
export function reasonData(reason) {
  if (reason === undefined) return { type: 'undefined' };
  if (reason === null) return { type: 'null' };
  if (reason instanceof Error) return { type: 'Error', name: reason.name, message: reason.message };
  return { type: typeof reason, value: reason };
}
export function retirement(record) {
  if (!record.exit || !record.close || !record.stdoutEOF || !record.stderrEOF || !record.eventsEOF || record.groupPresent !== false || record.captureFailure || record.unknownDescendants) return 'UNKNOWN';
  const identities = new Set();
  for (const child of record.children) {
    if (!Number.isSafeInteger(child.pid) || child.pid < 1 || identities.has(child.pid) || !child.exit || !child.close) return 'UNKNOWN';
    identities.add(child.pid);
  }
  return 'DIRECT_AND_REPORTED_CHILDREN_RETIRED';
}
export function singleflight(action) { let promise; return () => promise ??= Promise.resolve().then(action); }
