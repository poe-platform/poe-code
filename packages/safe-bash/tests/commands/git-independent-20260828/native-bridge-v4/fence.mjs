import { BASE, TOOLS, HASHES, canonical, ownedRoot, exact, need, sha256 } from './finite.mjs';

export const MISSING = Object.freeze([
  'Exact physical dyld shared-cache files/subcache identities and readable hash or independently qualified mapping for Git CoreServices/CoreFoundation/libz/libiconv/libSystem; no cache path is recorded.',
  'sandbox-exec libsandbox/libSystem runtime mapping; historical ENOENT/OS metadata is not a readable image hash.',
  'Node CoreFoundation/Security/libc++/libSystem and ps runtime mapping for separate harmless qualification/observer roles; ps load-command closure absent in this record.',
  'Owned synchronous ps capability exposing PID/birth/PGID/handle before admission receipt, plus bounded all-stream accounting; Node execFileSync is not that capability.',
  'OS-qualified default-deny read/exec/network profile, canonical no-link staging/publication, and 10+5/120-second cooperative closure with all children.',
]);
export function historicalPairs(records) {
  const record = records.records.toolRecords;
  const bytes = Buffer.from(record.base64, 'base64');
  need(sha256(bytes) === 'e76fc8b05c95523c5854bd9e72ed783be7afb1a0241decb732b5489e8afc0dc8', 'historical tool record');
  const tools = JSON.parse(bytes);
  return [TOOLS.git, TOOLS.sandbox].flatMap(tool => {
    const row = tools.inspection.find(item => item.invocation.args[1] === tool);
    need(row && row.invocation.receipt.target.sha256 === HASHES[tool === TOOLS.git ? 'git' : 'sandbox'], 'exact historical tool pair');
    return row.stdout.split('\n').filter(line => line.startsWith('\t')).map(line => ({
      tool, path: canonical(line.trim().split(' (')[0]),
      qualification: 'macOS26.4.1/build25E253 OS_METADATA_ONLY_NO_READABLE_HASH',
    }));
  });
}
export function renderFence(root, records) {
  ownedRoot(root);
  need(records.files.length === 18, 'eighteen authoritative fixture files');
  const emptyFiles = ['attributes', 'excludes', 'global.config', 'system.config'];
  const data = [TOOLS.git, `${root}/target.sb`, ...records.files.map(file => `${root}/repo/${file.path}`), ...emptyFiles.map(name => `${root}/empty/${name}`)];
  const directories = [root, `${root}/repo`, ...records.directories.map(entry => `${root}/repo/${entry.path}`), `${root}/empty`, ...['bin', 'home', 'xdg', 'hooks', 'git-core'].map(name => `${root}/empty/${name}`), `${root}/tmp`];
  const metadata = [...new Set([...data, ...directories, ...historicalPairs(records).filter(pair => pair.tool === TOOLS.git).map(pair => pair.path)])].sort();
  for (const path of [...data, ...metadata]) canonical(path);
  const rule = (operation, paths) => `(allow ${operation}\n${paths.map(path => `  (literal "${path}")`).join('\n')})`;
  return ['(version 1)', '(deny default)', '(deny network*)', '(deny file-write*)', rule('file-read-data', [...new Set([...data, ...directories])].sort()), rule('file-read-metadata', metadata), `(allow process-exec (literal "${TOOLS.git}"))`, ''].join('\n');
}
export function profileBinding(root, records) {
  return { path: `${ownedRoot(root)}/target.sb`, sha256: sha256(renderFence(root, records)), mode: 0o400, sharedCacheReads: [], qualification: 'UNQUALIFIED_NOT_DISPATCH_READY' };
}
export function wrapperRequest(recipe, profile) {
  const root = recipe.cwd.slice(0, -5);
  ownedRoot(root);
  exact(profile.path, `${root}/target.sb`, 'one exact profile file');
  need(/^[a-f0-9]{64}$/.test(profile.sha256) && profile.mode === 0o400, 'profile identity');
  return { executable: TOOLS.sandbox, args: ['-f', profile.path, recipe.executable, ...recipe.args], options: { cwd: recipe.cwd, env: { ...recipe.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] } };
}
export function dispatchActual() {
  throw new Error(`NOT_DISPATCH_READY: ${MISSING.join(' | ')}; no inherited GO; ${BASE}`);
}
