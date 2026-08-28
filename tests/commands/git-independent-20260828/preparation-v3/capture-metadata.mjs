import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const directory = 'tests/commands/git-independent-20260828/preparation-v3';
const author = '589d1d93e2cd87296949ff32d8bf4d9bbef6cbcc';
const review = '12e943bd3664a2f8286fc3063542877ae7f56a8e';
const supervisor = 'f03c260269dfd8ee10666f7fd2560655f8e14a38';
const proof = '652b76f4af9a03ba1fe0d8f90ca5128463f9e34b';
const driver = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3';
const independent = 'tests/integration/full-gate-20260827/unified76-driver-independent';
const inputs = [
  ['fixture', author, 'tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json'],
  ['authorBinding', author, 'tests/commands/git-design-20260828/BINDING.json'],
  ['proposal', author, 'tests/commands/git-design-20260828/README.md'],
  ['matrix', review, 'tests/commands/git-independent-20260828/MATRIX.md'],
  ['ratification', '70ba55eaaa705307eec5b985fc3d8963f6764159', 'tests/commands/git-independent-20260828/ratification-v2/RATIFIED.md'],
  ['commandContract', author, 'src/contracts/command.ts'],
  ['filesystemContract', author, 'src/contracts/filesystem.ts'],
  ['pluginContract', author, 'src/contracts/plugin.ts'],
  ['toolRecords', '97c081ec', `${independent}/tool-routes-v10/TOOL-CLOSURE.json`],
  ['supervisor', supervisor, `${driver}/supervise.mjs`],
  ['fence', supervisor, `${driver}/os-instruction-fence.mjs`],
  ['comparator', proof, `${independent}/supervisor-repair-v17/continuation-v2/compare.mjs`],
  ['supervisorProof', proof, `${independent}/supervisor-repair-v17/continuation-v2/HANDOFF.md`],
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const records = Object.fromEntries(inputs.map(([role, commit, path]) => {
  const bytes = execFileSync('git', ['show', `${commit}:${path}`], { maxBuffer: 1024 * 1024 });
  return [role, { commit, path, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') }];
}));
const fixture = JSON.parse(Buffer.from(records.fixture.base64, 'base64'));
const files = fixture.files.map(file => {
  const bytes = file.base64 === undefined ? Buffer.from(file.text) : Buffer.from(file.base64, 'base64');
  return { path: file.path, type: 'file', mode: file.mode, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') };
}).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const directories = [...new Set(files.flatMap(file => {
  const segments = file.path.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}))].sort().map(path => ({ path, type: 'directory', mode: 0o755 }));
const tree = [...directories, ...files.map(({ base64, ...entry }) => entry)].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const tools = JSON.parse(Buffer.from(records.toolRecords.base64, 'base64'));
const output = {
  schema: 'git-independent-preparation-records-v3',
  classification: 'INERT_DATA_METADATA_ONLY_NOT_EXECUTION_EVIDENCE',
  capturedAt: new Date().toISOString(),
  timing: 'POST_DESIGN_AND_RATIFICATION; PRE_CANDIDATE_IMPLEMENTATION_INSPECTION; no candidate inspected',
  records, files, directories, tree, treeSha256: sha256(JSON.stringify(tree)),
  workflows: fixture.proposedOutputs.map((row, index) => ({ id: `A0${index + 1}`, args: row.args, cwd: '/repo', env: {}, stdinBase64: '', exitCode: row.exitCode, stdoutBase64: Buffer.from(row.stdout).toString('base64'), stderrBase64: '', effects: 'EXACT_BASELINE_TREE_UNCHANGED', basis: 'PROJECT_PREDICTION_NATIVE_UNRUN' })),
  oids: fixture.oids,
  historicalTools: { selected: tools.selectedTools, inspector: tools.inspector, gitCore: tools.gitCore, qualification: tools.externalReceipt.qualification },
};
const text = `${JSON.stringify(output, null, 2)}\n`;
process.stdout.write(`*** Begin Patch\n*** Add File: ${directory}/records.json\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`);
