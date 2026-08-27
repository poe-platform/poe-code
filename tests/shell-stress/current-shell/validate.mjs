import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { owned, root, environment, runChild, sourceGuard, sha256, patchJson } from './support.mjs';

const report = { generatedAt: new Date().toISOString(), node: process.version, commands: [] };
const commands = [
  { name: 'focused-typecheck', args: ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--types', 'node', 'tests/shell-stress/current-shell/current-shell.test.ts'] },
  { name: 'global-typecheck', args: ['node_modules/typescript/bin/tsc', '--noEmit'] },
  { name: 'owned-node-test', args: ['--import', 'tsx', '--test', 'tests/shell-stress/current-shell/current-shell.test.ts'] },
];
for (const command of commands) {
  const before = await sourceGuard();
  const result = await runChild(process.execPath, command.args, { env: environment, deadline: command.name === 'owned-node-test' ? 390000 : 60000 });
  const after = await sourceGuard();
  report.commands.push({ ...command, executable: process.execPath, cwd: root, result, sourceGuard: { before, after, stable: before.sha256 === after.sha256 } });
  process.stderr.write(`${command.name}: ${result.status}, guard=${before.sha256 === after.sha256}\n`);
}
report.fixturesSha256 = sha256(await readFile(resolve(owned, 'cases.mjs')));
report.frozenSha256 = sha256(await readFile(resolve(owned, 'native-frozen.json')));
patchJson(process.argv[2] ?? 'pre-ready-validation.json', report);
