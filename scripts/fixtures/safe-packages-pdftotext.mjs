import assert from 'node:assert/strict';
import { Shell, createMemoryFileSystem } from '@poe-platform/safe-bash';
import { pdftotext, pdftotextCommands } from '@poe-platform/safe-bash/commands/pdftotext';

const fs = createMemoryFileSystem();
const shell = new Shell({ fs });
try {
  assert.equal((await shell.exec('pdftotext -h')).exitCode, 127);
  shell.use(pdftotextCommands());
  shell.use({ name: 'sdk-pdftotext', setup(host) {
    host.commands.register({ name: 'sdk-pdftotext', execute(context) {
      return pdftotext(context, { input: '-literal.pdf', output: '-', numbers: { resolution: 144 }, flags: { raw: true } });
    } });
  } });
  assert.deepEqual(await shell.exec('sdk-pdftotext'), await shell.exec('pdftotext -raw -r 144 -- -literal.pdf -'));
  const help = await shell.exec('pdftotext -h');
  assert.equal(help.exitCode, 0); assert.match(help.stdout, /extraction is unavailable/);
  assert.equal((await shell.exec('pdftotext -r72 -h')).exitCode, 99);
  const bytes = new Uint8Array([0, 128, 255]);
  await fs.writeFile('/output.txt', bytes);
  assert.equal((await shell.exec('pdftotext /input.pdf /output.txt')).exitCode, 99);
  assert.deepEqual(await fs.readFile('/output.txt'), bytes);
} finally { await shell.dispose(); }
console.log('pdftotext installed admission profile passed');
