import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { recognize, recognizePdf } from '../dist/index.js';

const image = await readFile(new URL('./fixtures/english.png', import.meta.url));

test('JavaScript invokes Rust OCR and returns layout', async () => {
  const result = await recognize(image);
  assert.match(result.text, /HELLO WORLD/);
  assert.match(result.tsv, /HELLO/);
  assert.match(result.hocr, /ocrx_word/);
});

test('JavaScript can supply model bytes', async () => {
  const model = await readFile(new URL('../assets/eng.traineddata', import.meta.url));
  const result = await recognize(image, { language: 'eng', model });
  assert.match(result.text, /HELLO WORLD/);
});

test('aborted OCR does not start', async () => {
  const reason = new Error('stop OCR');
  await assert.rejects(recognize(image, { signal: AbortSignal.abort(reason) }), error => error === reason);
});

test('cancellation drains native work and preserves the abort reason', async () => {
  const controller = new AbortController();
  const reason = new Error('stop active OCR');
  const pending = recognize(image, { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test('unconfigured languages and invalid limits fail clearly', async () => {
  await assert.rejects(recognize(image, { language: 'kor' }), /model/i);
  await assert.rejects(recognize(image, { limits: { maxPixels: 1 } }), /pixel/i);
});

test('JavaScript rejects numeric limits before native integer coercion', async () => {
  for (const value of [-1, 0, 1.5, NaN, Infinity, 2 ** 32]) {
    await assert.rejects(recognize(image, { limits: { maxInputBytes: value } }), /positive integer/i);
  }
  await assert.rejects(recognize(image, { dpi: 300.5 }), /positive integer/i);
});

test('JavaScript can turn a scanned PDF into searchable bytes', async () => {
  const input = await readFile(new URL('./fixtures/scanned.pdf', import.meta.url));
  const result = await recognizePdf(input);
  assert.match(result.text, /HELLO WORLD/);
  assert.equal(result.pages, 1);
  assert.equal(new TextDecoder().decode(result.pdf.subarray(0, 5)), '%PDF-');
});
