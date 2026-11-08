import { pathToFileURL } from 'node:url';
const { Shell, agentCommands, createMemoryFileSystem } = await import(pathToFileURL(process.argv[2]).href);
const originals = [
  { id: 'core-literal', optional: 'bash -e', source: '#!/usr/bin/env bash -e\nprintf forbidden > marker\n', cwd: '/work', command: './script', file: '/work/script', assertion: 'resume-host.ts:94 exitCode===126; stdout===empty; stderr matches unsupported interpreter; namespace only script' },
  ...['bash -e', '-S bash -e'].map((optional, index) => ({ id: `errexit-${index + 1}`, optional, source: `#!/usr/bin/env ${optional}\nprintf BAD\n`, cwd: '/', command: '/script', file: '/script', assertion: 'errexit-host.test.ts:131 exitCode===126; stdout===empty; stderr matches unsupported interpreter' })),
  ...['bash -e', '-S bash -e', 'python', null, 'bash\r'].map((optional, index) => ({ id: `expanded-${index + 1}`, optional, source: `#!/usr/bin/env${optional === null ? '' : ` ${optional}`}\nprintf forbidden`, cwd: '/', command: '/script', file: '/script', assertion: 'expanded-gaps-env-host.test.ts:7 exitCode===126; stdout===empty; stderr matches unsupported interpreter' })),
];
for (const variant of originals) {
  const fs = createMemoryFileSystem();
  if (variant.cwd !== '/') await fs.mkdir(variant.cwd);
  await fs.writeFile(variant.file, Buffer.from(variant.source), { mode: 0o755 });
  const shell = new Shell({ fs, cwd: variant.cwd }).use(agentCommands());
  try {
    const result = await shell.exec(variant.command);
    variant.observed = { status: result.exitCode, stdout: result.stdout, stderr: result.stderr, entries: (await fs.readdir(variant.cwd)).map(entry => entry.name).sort(), scriptUnchanged: Buffer.from(await fs.readFile(variant.file)).equals(Buffer.from(variant.source)) };
  } finally { await shell.dispose(); variant.disposed = true; }
}
process.stdout.write(JSON.stringify({ compiledEntry: process.argv[2], originals }, null, 2) + '\n');
