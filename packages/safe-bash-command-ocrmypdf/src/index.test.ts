import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createMemoryFileSystem, toByteSource } from '@poe-code/safe-fs/core';
import { createOcrmypdfCommand } from './index.js';

test('Ocrmypdf recognizes virtual PDFs and writes searchable bytes and sidecar text', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/scan.pdf', await readFile(new URL('../../tesseract-rust/tests/fixtures/scanned.pdf', import.meta.url)));
  let stderr = '';
  const result = await createOcrmypdfCommand().execute({ command: 'ocrmypdf', args: ['scan.pdf', 'result.pdf', '--sidecar', 'result.txt'], fs, cwd: '/', env: {}, signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write() { assert.fail('output should go to the virtual file'); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.equal(result.exitCode, 0, stderr);
  assert.match(new TextDecoder().decode(await fs.readFile('/result.txt')), /HELLO/);
  assert.equal(new TextDecoder().decode((await fs.readFile('/result.pdf')).subarray(0, 5)), '%PDF-');
});

test('limits reject input before producing a virtual output', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/scan.pdf', new Uint8Array(10));
  let stderr = '';
  const result = await createOcrmypdfCommand({ limits: { maxInputBytes: 1 } }).execute({ command: 'ocrmypdf', args: ['scan.pdf', 'result.pdf'], fs, cwd: '/', env: {}, signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.equal(result.exitCode, 1);
  await assert.rejects(fs.stat('/result.pdf'));
  assert.ok(stderr.length > 0);
});
