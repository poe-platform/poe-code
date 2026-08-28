import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(own, '../../../..');
const snapshot = '570e5accd0ff9686fbdc0b00ab1d01a20c82950e';
const author = 'bf25da0ed51b3d7cddf295a698020c524d4c27a3';
const git = '/usr/bin/git';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBytes = args => execFileSync(git, ['--no-replace-objects', ...args], {
  cwd: root,
  env: { PATH: '/usr/bin:/bin', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' },
  timeout: 10000,
  maxBuffer: 8 * 1024 * 1024,
});
const currentPaths = [
  'AGENTS.md',
  ...['command.ts', 'command.md', 'filesystem.ts', 'filesystem.md', 'io.ts', 'output.ts', 'path.ts', 'plugin.ts', 'errors.ts', 'index.ts'].map(name => `src/contracts/${name}`),
  ...['controller.mjs', 'supervisor.mjs', 'deadline.mjs', 'dispatch.mjs', 'worker.mjs', 'RESULT.md', 'SEAL.json'].map(name => `tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/${name}`),
  'tests/shell/indexed-arrays-independent-20260828/candidate-v1/boundary-app.mjs',
  'tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v3/staging.mjs',
  ...['loader.mjs', 'a01.mjs'].map(name => `tests/commands/xan-module-review-20260828/actual-review-v1/${name}`),
  ...['common.mjs', 'HANDOFF.md', 'PROTOCOL.md'].map(name => `tests/commands/xan-module-review-20260828/actual-review-v2/${name}`),
  ...['supervisor.mjs', 'HANDOFF.md', 'READINESS-AUDIT.md'].map(name => `tests/commands/xan-module-review-20260828/preparation-v2/${name}`),
  'tests/commands/xan-module-review-20260828/core.mjs',
  ...['typecheck.mjs', 'typecheck-inputs.mjs', 'typecheck-consumers.mjs', 'typecheck-staged-inputs.mjs', 'verify-current-consumers.mjs', 'verify-qualified-release.mjs'].map(name => `scripts/${name}`),
  ...['README.md', 'snapshot.mjs', 'consumers.mjs', 'inventory-check.mjs', 'runtime-coverage.mjs', 'inventory.json', 'captured-types.json', 'staged-types.json', 'tsconfig.consumer.json'].map(name => `tests/plugins/qualified-current-release/${name}`),
];
const tools = [node, git, ...['bin/tsc', 'lib/tsc.js', 'lib/_tsc.js', 'package.json'].map(name => `node_modules/typescript/${name}`)];
function entry(filename) {
  const absolute = path.resolve(root, filename);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw new Error('Input metadata capture requires a bounded regular file');
  const bytes = readFileSync(absolute);
  return { path: filename, resolvedPath: realpathSync(absolute), bytes: bytes.length, mode: stat.mode & 0o777, sha256: hash(bytes) };
}
const current = currentPaths.map(filename => {
  const observed = entry(filename);
  const storedBytes = gitBytes(['show', `${snapshot}:${filename}`]);
  const treeRecord = gitBytes(['ls-tree', snapshot, '--', filename]).toString('utf8').trim();
  return { ...observed, storedAt: snapshot, storedBytes: storedBytes.length, storedSha256: hash(storedBytes), gitTreeRecord: treeRecord };
});
const pinned = ['PROFILE-PROPOSAL-v1.md', 'CASES-v1.json', 'DESIGN-CHECK-v1.json', 'SOURCES-v1.json'].map(name => {
  const filename = `tests/commands/apply-patch-author-20260828/${name}`;
  const bytes = gitBytes(['show', `${author}:${filename}`]);
  return { path: filename, commit: author, bytes: bytes.length, sha256: hash(bytes), gitTreeRecord: gitBytes(['ls-tree', author, '--', filename]).toString('utf8').trim() };
});
const result = {
  schema: 'apply-patch-preparation-input-observations-v1',
  classification: 'READ_ONLY_INPUT_CAPTURE_NOT_PRODUCT_OR_CHECKER_EXECUTION',
  preparationSnapshotCommit: snapshot,
  snapshotQualification: 'Administrative reference for permitted contracts/reviewer/tooling paths only; never the candidate binding. No candidate source/test contents read.',
  current,
  pinned,
  tools: tools.map(entry),
  captureRuntime: { executable: process.execPath, version: process.version },
  toolQualification: 'Node and /usr/bin/git executable bytes and selected compiler entries only. Apple git launcher delegation, complete TypeScript libs/@types/tool tree, npm pack/install closure and runtime guards remain unbound until handoff. No runtime candidate authorization.',
  parentRule: { path: '../AGENTS.md', qualification: 'Read-only applicable instruction outside owned repository; not copied, edited, or claimed as committed repository input' },
};
const contents = JSON.stringify(result, null, 2) + '\n';
process.stdout.write('*** Begin Patch\n*** Add File: tests/commands/apply-patch-independent-20260828/admission-plan/INPUTS-v1.json\n');
process.stdout.write(contents.split('\n').slice(0, -1).map(line => `+${line}\n`).join(''));
process.stdout.write('*** End Patch\n');
