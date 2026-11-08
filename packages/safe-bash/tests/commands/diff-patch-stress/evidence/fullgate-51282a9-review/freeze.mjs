import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const base = 'tests/commands/diff-patch-stress/evidence/fullgate-51282a9-review';
const metadataBase = 'tests/commands/metadata-stress/evidence/fullgate-51282a9-review';
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = git('rev-parse', '72f780d').toString().trim();
const roots = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/diff-patch-stress/fuzz', 'tests/commands/diff-patch-stress/emptyfile-delta', 'tests/commands/diff-patch-stress/editflows', 'tests/commands/metadata-stress', 'tests/commands/table-text-stress'];
const entries = git('ls-tree', '-r', revision, '--', ...roots).toString().trim().split('\n').map(line => {
  const [metadata, path] = line.split('\t');
  const [mode, type, blob] = metadata.split(' ');
  const bytes = git('cat-file', 'blob', blob);
  return { path, mode, type, blob, bytes: bytes.length, sha256: hash(bytes) };
});
const classification = JSON.parse(readFileSync('tests/integration/full-gate-20260827/evidence/classification.json', 'utf8'));
const failures = classification.failures.filter(row => /tests\/commands\/(diff-patch-stress|metadata-stress|table-text-stress)\//.test(row.path));
const targets = [...new Set(failures.map(row => row.path))];
function save(path, value) {
  if (existsSync(path)) throw new Error(`Refusing to replace frozen evidence: ${path}`);
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 16 * 1024 * 1024 });
}
save(`${base}/initial-freeze.json`, { capturedAt: new Date().toISOString(), revision, head: git('rev-parse', 'HEAD').toString().trim(), node: process.version, platform: process.platform, arch: process.arch, status: git('status', '--short').toString(), index: git('diff', '--cached', '--name-status').toString(), roots, entries, targets, failures, classificationSha256: hash(readFileSync('tests/integration/full-gate-20260827/evidence/classification.json')) });
for (const path of targets) save(`${path.includes('diff-patch-stress') ? base : metadataBase}/originals/${path.replaceAll('/', '__')}.txt`, git('show', `${revision}:${path}`).toString());
save(`${metadataBase}/initial-native-prerequisites.json`, readFileSync('tests/integration/full-gate-20260827/evidence/native-prerequisites.json', 'utf8'));
console.log(JSON.stringify({ revision, files: entries.length, targets, originalFailures: failures.length }));
