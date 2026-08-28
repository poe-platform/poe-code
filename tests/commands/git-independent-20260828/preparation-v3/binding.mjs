import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const api = ['createGitCommand', 'createGitCommands', 'gitCommands'];
export const safeBuiltins = ['node:assert/strict', 'node:buffer', 'node:crypto', 'node:events', 'node:path', 'node:stream', 'node:util', 'node:zlib'];
export class Hold extends Error {
  constructor(message) { super(`PREPARED/HOLD: ${message}`); }
}
export function requireReady(condition, message) {
  if (!condition) throw new Hold(message);
}
export function relativePath(path) {
  requireReady(typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && posix.normalize(path) === path && !path.split('/').includes('..'), 'finite relative path');
  return path;
}
export function admitCandidate(packetBytes, go, files, preparationSha256) {
  requireReady(Buffer.isBuffer(packetBytes), 'exact candidate packet bytes missing');
  requireReady(go?.action === 'ROOT_GIT_CANDIDATE_EXECUTE' && typeof go.authorization === 'string' && go.authorization.trim().length >= 16 && !/template|placeholder|example/i.test(go.authorization), 'fresh external ROOT candidate GO missing');
  requireReady(go.packetSha256 === sha256(packetBytes) && go.preparationSha256 === preparationSha256 && /^[a-f0-9]{64}$/.test(preparationSha256), 'ROOT packet/preparation binding');
  const packet = JSON.parse(packetBytes);
  requireReady(packet.schema === 'git-candidate-for-preparation-v3', 'candidate schema');
  requireReady(/^[a-f0-9]{40}$/.test(packet.candidateCommit) && packet.candidateCommit === go.candidateCommit, 'exact frozen candidate commit');
  requireReady(['source-emitted', 'installed', 'moved', 'type'].includes(packet.kind) && packet.kind === go.kind, 'independently authorized route');
  requireReady(/^[a-f0-9]{64}$/.test(packet.archiveSha256) && packet.archiveSha256 === go.archiveSha256, 'authenticated archive');
  requireReady(packet.census === 'EXACT_ALL_ENTRIES_NO_LIVE_OVERLAY' && packet.liveFallback === false, 'no live/dist fallback');
  assert.deepEqual(packet.api, api, 'exact proposed runtime API');
  assert.deepEqual(packet.context, { cwd: '/repo', env: {}, stdinBase64: '' }, 'exact child context');
  requireReady(Array.isArray(packet.files) && packet.files.length > 0 && packet.files.length <= 512 && files instanceof Map, 'finite closure bytes');
  requireReady(new Set(packet.files.map(file => file.path)).size === packet.files.length && files.size === packet.files.length, 'exact file census');
  for (const file of packet.files) {
    relativePath(file.path);
    requireReady(file.mode === 0o644 && file.type === 'file', 'regular candidate input only');
    const bytes = files.get(file.path);
    requireReady(Buffer.isBuffer(bytes) && bytes.length === file.bytes && sha256(bytes) === file.sha256, `candidate bytes ${file.path}`);
  }
  for (const field of ['sourceFiles', 'packageFiles']) requireReady(Array.isArray(packet[field]) && packet[field].length > 0 && packet[field].every(path => files.has(relativePath(path))), `exact ${field}`);
  requireReady(packet.packageFiles.some(path => path.endsWith('package.json')), 'package manifest binding');
  requireReady(files.has(relativePath(packet.entry)) && /\.(?:mjs|js)$/.test(packet.entry), 'exact emitted entry, not live TS/dist alias');
  requireReady(packet.imports && typeof packet.imports === 'object' && !Array.isArray(packet.imports), 'explicit relative import closure');
  requireReady(Object.keys(packet.imports).includes(packet.entry), 'entry closure declaration');
  requireReady(Array.isArray(packet.builtins) && new Set(packet.builtins).size === packet.builtins.length && packet.builtins.every(name => safeBuiltins.includes(name)), 'finite non-host builtin closure');
  for (const [from, edges] of Object.entries(packet.imports)) {
    requireReady(files.has(relativePath(from)) && Array.isArray(edges), 'declared module exists');
    for (const edge of edges) {
      requireReady(typeof edge.specifier === 'string' && typeof edge.to === 'string', 'literal import edge');
      if (edge.specifier.startsWith('node:')) requireReady(edge.to === edge.specifier && packet.builtins.includes(edge.to), 'authorized builtin edge');
      else {
        requireReady(edge.specifier.startsWith('./') || edge.specifier.startsWith('../'), 'no ambient package/absolute import');
        requireReady(relativePath(posix.join(posix.dirname(from), edge.specifier)) === edge.to && Object.hasOwn(packet.imports, edge.to), 'closed relative edge');
      }
    }
  }
  for (const role of ['node', 'compiler']) {
    const tool = packet[role];
    requireReady(tool && typeof tool.path === 'string' && tool.path.startsWith('/') && /^[a-f0-9]{64}$/.test(tool.sha256) && typeof tool.version === 'string' && tool.version.length > 0, `exact ${role} binding`);
  }
  requireReady(packet.build && /^[a-f0-9]{64}$/.test(packet.build.receiptSha256) && Array.isArray(packet.build.argv) && packet.build.argv.length > 0, 'source-to-emitted build provenance');
  requireReady(packet.toolBindings && /^[a-f0-9]{64}$/.test(packet.toolBindings.sha256), 'finite tools/import roles');
  requireReady(typeof packet.moduleSpecifier === 'string' && packet.moduleSpecifier.length > 0 && /^[a-f0-9]{64}$/.test(packet.packageResolutionSha256), 'source/package resolution receipt');
  if (packet.kind === 'moved') requireReady(packet.originalRootAbsent === true && packet.movedResolutionSha256 && /^[a-f0-9]{64}$/.test(packet.movedResolutionSha256), 'moved-root independent resolution');
  return packet;
}
export async function authorizeThenLoad(packetBytes, go, files, preparationSha256, loader) {
  const packet = admitCandidate(packetBytes, go, files, preparationSha256);
  requireReady(packet.kind !== 'type', 'type route never evaluates implementation');
  const namespace = await loader(packet, new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)])));
  assert.deepEqual(Object.keys(namespace).sort(), [...api].sort(), 'runtime exports');
  for (const name of api) assert.equal(typeof namespace[name], 'function', `callable ${name}`);
  return { packet, namespace };
}
