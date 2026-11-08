import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { escapeRbsp } from './binary.js';
import { h264FieldOrderSteps } from './h264-field-order.js';
import { probeMp4, probeMp4Source } from './index.js';

for (const [fixture, order] of [['packet-positions-faststart', 'progressive'], ['h264-tff', 'tt'], ['h264-bff', 'bb']] as const) {
  for (const reader of ['resident', 'source']) it(`${reader} reports ${order} H.264 field order`, async () => {
    const bytes = readFileSync(new URL(`./fixtures/${fixture}.mp4`, import.meta.url));
    const probe = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
      size: bytes.length,
      async read(start, length) { assert.ok(length <= 16384); return bytes.slice(start, start + Math.min(length, 31)); }
    }, { syncSamples() { const keys = new Set<number>(); return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } }; } });
    for await (const stream of probe.streams) assert.equal(stream.field_order, order);
  });
}

function timing(bytes: Uint8Array, delayBits = 0, nalLengthSize = 1) {
  const steps = h264FieldOrderSteps({ payloadOffset: 0, payloadSize: bytes.length }, { delayBits, nalLengthSize });
  let next = steps.next();
  while (!next.done) {
    assert.equal(next.value.kind, 'read');
    if (next.value.kind !== 'read') throw new Error('Unexpected step');
    assert.ok(next.value.offset + next.value.length <= bytes.length);
    next = steps.next(bytes.subarray(next.value.offset, next.value.offset + next.value.length));
  }
  return next.value;
}

it('reads picture timing after HRD delays and emulation prevention bytes', () => {
  const payload = escapeRbsp(Uint8Array.of(1, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x80));
  const bytes = Uint8Array.of(payload.length + 1, 6, ...payload);
  assert.equal(timing(bytes, 64), 'bb');
});

it('handles all AVCC length sizes and ignores unsupported or truncated timing', () => {
  for (const lengthSize of [1, 2, 3, 4]) {
    const bytes = Uint8Array.of(...new Uint8Array(lengthSize - 1), 5, 6, 1, 1, 0x30, 0x80);
    assert.equal(timing(bytes, 0, lengthSize), 'tt');
    for (let end = 0; end < bytes.length; end++) assert.equal(timing(bytes.slice(0, end), 0, lengthSize), undefined);
  }
  assert.equal(timing(Uint8Array.of(5, 6, 1, 1, 0xf0, 0x80)), undefined);
  assert.equal(timing(Uint8Array.of(5, 6, 1, 1, 0x30, 0x80), 64), undefined);
});
