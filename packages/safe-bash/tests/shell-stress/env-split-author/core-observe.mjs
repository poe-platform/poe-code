import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Shell, agentCommands, createMemoryFileSystem } from '../../../src/index.ts';
import { allScenarios, observeCase } from './resume-fixtures.ts';
import { environment, protocols } from './cases.mjs';

const paths = ['src/commands/execution.ts', 'src/commands/env-split.ts', 'src/commands/internal.ts', 'src/contracts/command.ts', 'src/shell/runtime.ts'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshot = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(path))])));
const report = { before: await snapshot(), importedRuntime: import.meta.resolve('../../../src/shell/runtime.js'), importedHelper: import.meta.resolve('../../../src/commands/env-split.js'), core: [], protocol: [] };
for (const scenario of allScenarios) report.core.push(await observeCase(scenario.name));
for (const [name, optional] of protocols) {
  const fs = createMemoryFileSystem(); await fs.mkdir('/sub');
  const source = `#!/usr/bin/env ${optional}\nprintf '[%s][%s]:%s' "$1" "$2" "$KEEP"; false; printf BAD\n`;
  await fs.writeFile('/script', Buffer.from(source), { mode: 0o755 });
  await fs.writeFile('/sub/script', Buffer.from('printf relocated; false; printf BAD\n'));
  const shell = new Shell({ fs, env: { PATH: '', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...environment } }).use(agentCommands());
  try {
    const result = await shell.exec("./script '' 'a b'");
    report.protocol.push({ name, source, observed: { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex') } });
  } finally { await shell.dispose(); }
}
report.after = await snapshot(); assert.deepEqual(report.after, report.before);
assert.ok(process.argv[2]?.startsWith('/tmp/'));
await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ core: report.core.length, protocol: report.protocol.map(({name,observed})=>({name,status:observed.status})), stableSource: true }));
