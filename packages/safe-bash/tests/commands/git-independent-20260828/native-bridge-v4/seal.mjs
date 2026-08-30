import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { preparationData } from './future-recipe.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const file = path => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('regular source/data only');
  const bytes = readFileSync(path);
  return { path: path.slice(directory.length + 1), mode: stat.mode & 0o777, bytes: bytes.length, sha256: digest(bytes) };
};
const parent = join(directory, '../preparation-v3');
const protectedInputs = readdirSync(parent).sort().map(name => ({ ...file(join(parent, name)), path: `../preparation-v3/${name}` }));
const names = ['finite.mjs', 'fence.mjs', 'recipe.mjs', 'account.mjs', 'whole-h11.mjs', 'bridge.mjs', 'collector.mjs', 'synthetic.mjs', 'future-recipe.mjs', 'stubs.json', 'seal.mjs', 'run-synthetic.mjs', 'README.md'];
const data = preparationData(JSON.parse(readFileSync(join(parent, 'records.json'))));
const rendered = JSON.stringify(data, null, 2) + '\n';
const manifest = {
  schema: 'git-native-bridge-v4-preseal', classification: 'SOURCE_DATA_SYNTHETIC_ONLY', date: '2026-08-28',
  sources: names.map(name => file(join(directory, name))), protectedInputs,
  rendered: { path: 'rendered.json', mode: 0o644, bytes: Buffer.byteLength(rendered), sha256: digest(rendered) },
  syntax: { executable: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', argv: ['--check', '<each exact .mjs in sources order>'], deadlineMs: 10000, status: 'UNRUN_AT_SEAL', qualification: 'existing development path only, no fresh tool/version/hash inspection' },
  cohort: { count: 26, ids: Array.from({ length: 26 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`),
    argv: ['/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', '--experimental-vm-modules', '--no-warnings', `${directory}/run-synthetic.mjs`],
    env: { PATH: '/dev/null', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    wallMs: 120000, rawStdoutBytes: 65536, rawStderrBytes: 65536, retries: 0,
    vmEvaluationMs: 1000, mockedNativeWorkflowMs: 10000, mockedCleanupMs: 5000, mockedOverallMs: 120000, mockedAllChildBytes: 65536,
    capture: ['synthetic-01.stdout.jsonl', 'synthetic-01.stderr.txt', 'synthetic-01.status.txt'],
    imports: 'All owned .mjs files sealed; synthetic dynamically imported only after exact source/data guard; no product, real child_process, H11 actual imports, native, or fallback.',
  },
  actualNative: 'A01-A06_UNRUN', module: 'UNRUN', typeAll: 'UNRUN', OS: 'UNEXECUTED',
};
process.stdout.write('*** Begin Patch\n');
for (const [name, text] of [['rendered.json', rendered], ['PRESEAL.json', JSON.stringify(manifest, null, 2) + '\n']]) {
  process.stdout.write(`*** Add File: ${directory}/${name}\n${text.split('\n').slice(0, -1).map(line => '+' + line).join('\n')}\n`);
}
process.stdout.write('*** End Patch\n');
