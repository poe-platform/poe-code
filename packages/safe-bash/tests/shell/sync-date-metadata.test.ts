import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.js';
import { basicCommands } from '../../src/commands/basic.js';
import { streamCommands } from '../../src/commands/streams.js';
import { createTimeEnvCommands } from '../../src/commands/time-env/index.js';

for (const source of ['date -u -r /stamp +%s | cat', 'value=$(date -u -r /stamp +%s); echo "$value"', 'for ((i=0;i<2;i++)); do date -u -r /stamp +%s; done']) {
  test(`sync date uses canonical file metadata: ${source}`, async context => {
    const {fs,shell,commands} = setup();
    context.after(() => shell.dispose());
    for (const command of [...basicCommands(),...streamCommands(),...createTimeEnvCommands()]) commands.register(command);
    await fs.writeFile('/stamp',new Uint8Array());
    await fs.utimes!('/stamp',123,1704067200000);
    const result = await shell.exec(source);
    assert.equal(result.exitCode,0,result.stderr);
    assert.equal(result.stderr,'');
    assert.equal(result.stdout,source.startsWith('for ') ? '1704067200\n1704067200\n' : '1704067200\n');
  });
}


for (const source of [
  'date -uj -r 1700000000 -v+1d +%F | cat',
  'value=$(date -uj -r 1700000000 -v+1d +%F); echo "$value"',
  'for ((i=0;i<2;i++)); do date -uj -r 1700000000 -v+1d +%F; done',
]) {
  test(`BSD date survives shell evaluation: ${source}`, async context => {
    const {shell,commands} = setup();
    context.after(() => shell.dispose());
    for (const command of [...basicCommands(),...streamCommands(),...createTimeEnvCommands()]) commands.register(command);
    const result = await shell.exec(source);
    assert.equal(result.exitCode,0,result.stderr);
    assert.equal(result.stderr,'');
    assert.equal(result.stdout,source.startsWith('for ') ? '2023-11-15\n2023-11-15\n' : '2023-11-15\n');
  });
}
