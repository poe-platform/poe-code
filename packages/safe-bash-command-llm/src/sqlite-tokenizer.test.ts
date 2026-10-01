import assert from 'node:assert/strict';
import test from 'node:test';
import { toByteSource } from 'safe-bash-contracts';
import { streamSqliteUnicode61 } from './sqlite-tokenizer.js';

// Independent ASCII subset of unicode61 for lifecycle and resource tests.
function tokenize(bytes: Uint8Array) {
  const tokens: { bytes: Uint8Array; start: number; end: number }[] = [];
  let start = 0;
  const letter = (byte: number) => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122;
  while (start < bytes.length) {
    if (!letter(bytes[start]!)) { start++; continue; }
    let end = start + 1;
    while (end < bytes.length && letter(bytes[end]!)) end++;
    tokens.push({ start, end, bytes: bytes.slice(start, end).map(byte => byte <= 90 ? byte + 32 : byte) }); start = end;
  }
  return tokens;
}

test('streamed SQLite tokens preserve words across source chunks', async () => {
  async function* source() { for (const text of ['AL', 'PHA be', 'ta ', 'ga', 'mma']) yield new TextEncoder().encode(text); }
  const result: string[] = [];
  for await (const token of streamSqliteUnicode61(source(), new AbortController().signal, tokenize)) result.push(new TextDecoder().decode(token));
  assert.deepEqual(result, ['alpha', 'beta', 'gamma']);
});

test('streamed SQLite tokens retain only the native indexed prefix and bound native inputs', async () => {
  let peak = 0;
  const result: Uint8Array[] = [];
  for await (const token of streamSqliteUnicode61(toByteSource('X'.repeat(100000) + ' beta'), new AbortController().signal, bytes => { peak = Math.max(peak, bytes.length); return tokenize(bytes); })) result.push(token);
  assert.equal(result.length, 2); assert.deepEqual(result[0], new Uint8Array(32768).fill(120));
  assert.equal(new TextDecoder().decode(result[1]), 'beta'); assert.ok(peak <= 16393);
});

test('streamed SQLite tokens return the source on cancellation and early termination', async () => {
  let closed = 0;
  async function* source() { try { while (true) yield new TextEncoder().encode('alpha beta '); } finally { closed++; } }
  for await (const token of streamSqliteUnicode61(source(), new AbortController().signal, tokenize)) { assert.ok(token.length); break; }
  assert.equal(closed, 1);
  const controller = new AbortController(), error = new Error('cancel');
  await assert.rejects(async () => {
    for await (const ignoredToken of streamSqliteUnicode61(source(), controller.signal, tokenize)) controller.abort(error);
  }, value => value === error);
  assert.equal(closed, 2);
});


test('empty source chunks cannot starve scheduled tokenizer cancellation', async () => {
  const controller = new AbortController();
  let closed = false;
  const source = (async function* () {
    try { for (let index = 0; index < 1024; index++) yield new Uint8Array(); }
    finally { closed = true; }
  })();
  const timer = setImmediate(() => controller.abort(new Error('empty stream stop')));
  try {
    await assert.rejects(async () => {
      for await (const token of streamSqliteUnicode61(source, controller.signal, () => {
        assert.fail('empty input must not invoke native tokenizer');
      })) assert.fail(`unexpected token ${token.length}`);
    }, /empty stream stop/);
  } finally { clearImmediate(timer); }
  assert.equal(closed, true);
});
