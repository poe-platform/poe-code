import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createCommandArguments } from 'safe-bash-contracts';
import { createPdftotextCommand, extractPdfToTextBytes, runPdftotextCli } from './index.js';

it('extracts the unchanged PDF.js Type 3 spacing fixture through both command APIs', async () => {
  const bytes = readFileSync(new URL('../../pdf-ast/src/fixtures/pdfjs-Type3WordSpacing.pdf', import.meta.url));
  const expected = 'ab\nbaba\nabba\nabab\nabbaabba\nba\nabab baba abbaabba\nab\nba\nabba\n\n\f';
  const direct = extractPdfToTextBytes(bytes, []);
  assert.equal(direct.exitCode, 0);
  assert.equal(direct.output, expected);
  const result = await runPdftotextCli(['in.pdf', '-'], new Map([['in.pdf', bytes]]));
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, expected);
});

for (const flags of [[], ['-layout'], ['-fixed', '8']]) it(`streams Type 3 spacing through the shell command (${flags.join(' ')})`, async () => {
  const bytes = readFileSync(new URL('../../pdf-ast/src/fixtures/pdfjs-Type3WordSpacing.pdf', import.meta.url));
  const fs = createMemoryFileSystem(); await fs.writeFile('/input.pdf', bytes);
  const args = createCommandArguments([...flags, 'input.pdf', '-']);
  const chunks: Uint8Array[] = [];
  const result = await createPdftotextCommand().execute({
    command: 'pdftotext', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString(), extractPdfToTextBytes(bytes, flags).output);
  assert.deepEqual(await fs.readdir('/scratch'), []);
});
