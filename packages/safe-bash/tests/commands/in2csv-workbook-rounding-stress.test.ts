import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Codec } from '@poe-code/csvkit';
import reference from '../../../../docs/csvkit/in2csv-workbook-rounding-reference.json' with { type: 'json' };
import styleReference from '../../../../docs/csvkit/in2csv-workbook-style-reference.json' with { type: 'json' };
import sectionReference from '../../../../docs/csvkit/in2csv-workbook-section-reference.json' with { type: 'json' };
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { csvkitCommands, type CsvkitCommandsOptions } from '../../src/commands/csvkit/index.js';

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
  clock: { now: () => 0 }, terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

for (const profile of [reference, styleReference, sectionReference]) for (const item of profile.cases) test(`actual Shell native workbook cell semantics ${item.argv.join(' ')}`, async () => {
  const fs = new MemoryFileSystem();
  const filename = item.argv[item.argv.length - 1]!;
  const bytes = Uint8Array.from(Buffer.from(profile.binary, 'base64'));
  await fs.writeFile('/' + filename, bytes);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec(`in2csv ${item.argv.join(' ')}`);
    const effects: Record<string, string> = {};
    for (const entry of await fs.readdir('/')) if (entry.name !== filename) {
      effects[entry.name] = Buffer.from(await fs.readFile('/' + entry.name)).toString('base64');
    }
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode, effects }, {
      stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects
    });
    assert.deepEqual(await fs.readFile('/' + filename), bytes);
  } finally { await shell.dispose(); }
});
