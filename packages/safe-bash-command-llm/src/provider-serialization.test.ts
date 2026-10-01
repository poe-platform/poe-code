import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeLlmJsonString, serializeLlmJsonValue, encodeLlmBase64 } from './providers/index.js';

function split(bytes: Uint8Array, width: number) { return { async *[Symbol.asyncIterator]() {
  for (let offset = 0; offset < bytes.length; offset += width) yield bytes.subarray(offset, offset + width);
} }; }
async function text(source: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder(); let value = '';
  for await (const chunk of source) { assert.ok(chunk.length <= 16384); value += decoder.decode(chunk, { stream: true }); }
  return value + decoder.decode();
}

test('public primitives compose native provider parts without changing their request shape', async () => {
  const signal = new AbortController().signal;
  const prompt = 'text\n"☃🙂\\';
  const data = Uint8Array.from({ length: 256 }, (_, index) => index);
  let encoded = '';
  for await (const chunk of encodeLlmBase64(split(data, 5), signal)) encoded += chunk;
  const body = '{"contents":[{"role":"user","parts":[{"text":' +
    await text(serializeLlmJsonString(split(new TextEncoder().encode(prompt), 1), signal)) +
    '},{"inlineData":{"mimeType":"application/pdf","data":"' + encoded + '"}}]}],"generationConfig":' +
    await text(serializeLlmJsonValue({ temperature: 0.5, responseMimeType: 'application/json' }, signal)) + '}';
  assert.deepEqual(JSON.parse(body), { contents: [{ role: 'user', parts: [{ text: prompt },
    { inlineData: { mimeType: 'application/pdf', data: Buffer.from(data).toString('base64') } }] }],
    generationConfig: { temperature: 0.5, responseMimeType: 'application/json' } });
});

test('public serializers bound emitted chunks for large controls and binary input', async () => {
  const signal = new AbortController().signal;
  const description = '\u0000🙂'.repeat(32768);
  assert.deepEqual(JSON.parse(await text(serializeLlmJsonValue({ description }, signal))), { description });
  const input = new Uint8Array(131072).fill(255);
  let length = 0;
  for await (const chunk of encodeLlmBase64(split(input, input.length), signal)) {
    assert.ok(chunk.length <= 16384); length += chunk.length;
  }
  assert.equal(length, Math.ceil(input.length / 3) * 4);
});

test('public text and binary serializers retire pending input on cancellation', async () => {
  for (const encode of [serializeLlmJsonString, encodeLlmBase64]) {
    const controller = new AbortController();
    let acquired!: () => void;
    const pending = new Promise<void>(resolve => { acquired = resolve; });
    let returned = 0;
    const source = { [Symbol.asyncIterator]() { return {
      next() { acquired(); return new Promise<IteratorResult<Uint8Array>>(() => undefined); },
      async return() { returned++; return { done: true as const, value: undefined }; },
    }; } };
    const consuming = (async () => { for await (const ignored of encode(source, controller.signal)) void ignored; })();
    await pending; controller.abort(new Error('stop native serialization'));
    await assert.rejects(consuming, { message: 'stop native serialization' });
    assert.equal(returned, 1);
  }
});
