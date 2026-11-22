import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createMemoryFileSystem, toByteSource } from '@poe-code/safe-fs/core';
import { createTesseractCommand } from './index.js';

test('Tesseract recognizes virtual files and writes positioned output', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/scan.png', await readFile(new URL('../../tesseract-rust/tests/fixtures/english.png', import.meta.url)));
  let stderr = '';
  const result = await createTesseractCommand().execute({ command: 'tesseract', args: ['scan.png', 'result', 'tsv'], fs, cwd: '/', env: {}, signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write() { assert.fail('output should go to the virtual file'); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.equal(result.exitCode, 0, stderr);
  assert.match(new TextDecoder().decode(await fs.readFile('/result.tsv')), /HELLO/);
});

test('limits reject input before producing a virtual output', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/scan.png', new Uint8Array(10));
  let stderr = '';
  const result = await createTesseractCommand({ limits: { maxInputBytes: 1 } }).execute({ command: 'tesseract', args: ['scan.png', 'result'], fs, cwd: '/', env: {}, signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.equal(result.exitCode, 1);
  await assert.rejects(fs.stat('/result.txt'));
  assert.ok(stderr.length > 0);
});
