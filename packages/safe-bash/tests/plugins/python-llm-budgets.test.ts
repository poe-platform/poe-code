import assert from 'node:assert/strict';
import test from 'node:test';
import { createPythonLlmCapability } from '../../src/commands/python/llm-capability.js';
import { createLlmService } from '../../src/commands/llm/service.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

const signal = new AbortController().signal;
const context = { fs: new MemoryFileSystem(), cwd: '/' };

test('host buffered ceiling cannot be omitted or raised by the guest; streaming stays independent', async () => {
  let closed = 0;
  const service = createLlmService({ defaultModel: 'm', providers: [{ name: 'test', models: [{ id: 'm' }], async *complete() {
    try { yield 'x'.repeat(4096); } finally { closed++; }
  } }] });
  const capability = createPythonLlmCapability(context, service, { maxBufferedResponseBytes: 128 });
  for (const payload of [{}, { max_response_bytes: 999999 }]) {
    await assert.rejects(capability.call!({ operation: 'complete', payload }, { signal }), /limit/i);
  }
  let text = '';
  for await (const value of capability.stream!({}, { signal })) {
    const event = value as { type: string; text?: string };
    if (event.type === 'text') text += event.text;
  }
  assert.equal(text.length, 4096);
  assert.equal(closed, 3);
});

test('buffered budgets account for escaping, byte arrays, empty events and metadata before retention', async () => {
  for (const output of ['"'.repeat(48), new Uint8Array(32).fill(255), 'empty', 'metadata']) {
    let emitted = 0, closed = 0;
    const service = createLlmService({ defaultModel: 'm', providers: [{ name: 'test', models: [{ id: 'm', outputType: typeof output === 'string' ? 'text/plain' : 'application/octet-stream' }], async *complete() {
      try {
        if (output === 'empty') for (let i = 0; i < 1000; i++) { emitted++; yield ''; }
        else if (output !== 'metadata') yield output;
        return { metadata: { detail: output === 'metadata' ? 'x'.repeat(4096) : 'small' } };
      } finally { closed++; }
    } }] });
    const capability = createPythonLlmCapability(context, service, { maxBufferedResponseBytes: 96, maxBufferedEvents: 8 });
    await assert.rejects(capability.call!({ operation: 'complete', payload: {} }, { signal }), /limit/i);
    if (output === 'empty') assert.equal(emitted, 9);
    assert.equal(closed, 1);
  }
});

test('text streams preserve Unicode and fragment before finite host message serialization', async () => {
  let closed = 0;
  const text = 'a🌍é\n'.repeat(16384);
  const service = createLlmService({ defaultModel: 'm', providers: [{ name: 'test', models: [{ id: 'm' }], async *complete() {
    try { yield text; return { metadata: { id: 'one' } }; } finally { closed++; }
  } }] });
  const capability = createPythonLlmCapability(context, service, { maxStreamChunkBytes: 1024 });
  let result = '', terminals = 0;
  for await (const value of capability.stream!({}, { signal })) {
    const event = value as { type: string; text?: string };
    if (event.type === 'text') {
      assert.ok(new TextEncoder().encode(event.text).length <= 1024);
      assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(event.text)), event.text);
      result += event.text;
    } else terminals++;
  }
  assert.equal(result, text);
  assert.equal(terminals, 1);
  const early = capability.stream!({}, { signal })[Symbol.asyncIterator]();
  await early.next();
  await early.return!();
  assert.equal(closed, 2);
});


test('buffered ceiling admits exact JSON bytes and counts envelopes and escaped text', async () => {
  const expected = {model:'m',text:'🌍"\n',data:[],metadata:{key:'value'}};
  const limit = new TextEncoder().encode(JSON.stringify(expected)).length;
  const service = createLlmService({defaultModel:'m',providers:[{name:'test',models:[{id:'m'}],async *complete() {
    yield expected.text;
    return {metadata:expected.metadata};
  }}]});
  const accepted = createPythonLlmCapability(context,service,{maxBufferedResponseBytes:limit,maxMetadataBytes:1024});
  assert.deepEqual(await accepted.call!({operation:'complete',payload:{}},{signal}),expected);
  const refused = createPythonLlmCapability(context,service,{maxBufferedResponseBytes:limit - 1,maxMetadataBytes:1024});
  await assert.rejects(refused.call!({operation:'complete',payload:{}},{signal}),/limit/);
});

test('embedding results obey host vector envelope and metadata ceilings and guest limits', async () => {
  const result = {model:'m',vectors:[[1,2,3]],metadata:{detail:'🌍"'}};
  const service = createLlmService({defaultModel:'m',providers:[{name:'test',models:[{id:'m',capabilities:['embed']}],async *complete() {yield '';},async embed() {return result;}}]});
  const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
  const payload = {inputs:['one']};
  const accepted = createPythonLlmCapability(context,service,{maxBufferedResponseBytes:bytes,maxMetadataBytes:128});
  assert.deepEqual(await accepted.call!({operation:'embed',payload},{signal}),result);
  const refused = createPythonLlmCapability(context,service,{maxBufferedResponseBytes:bytes - 1,maxMetadataBytes:128});
  for (const max_response_bytes of [undefined,999999]) {
    await assert.rejects(refused.call!({operation:'embed',payload:{...payload,...max_response_bytes === undefined ? {} : {max_response_bytes}}},{signal}),/limit/);
  }
  await assert.rejects(accepted.call!({operation:'embed',payload:{...payload,max_response_bytes:bytes - 1}},{signal}),/limit/);
  const metadata = createPythonLlmCapability(context,service,{maxBufferedResponseBytes:1024,maxMetadataBytes:4});
  await assert.rejects(metadata.call!({operation:'embed',payload},{signal}),/limit/);
});

test('retained response streams obey host UTF-8 limits through buffered and source inputs', async () => {
  for (const sourceInput of [false, true]) {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/prompt.txt', new TextEncoder().encode('test'));
    let output = 'é'.repeat(4), closed = 0;
    const complete = async function* () { try { yield output; } finally { closed++; } };
    const service = createLlmService({ defaultModel: 'm', providers: [{
      name: 'test', models: [{ id: 'm' }], complete, completeSources: complete,
    }] });
    const capability = createPythonLlmCapability({ fs, cwd: '/' }, service, {
      maxBufferedResponseBytes: 8, maxBufferedEvents: 16, maxMetadataBytes: 128, maxStreamChunkBytes: 4,
    });
    const payload = { prompt: sourceInput ? { path: '/prompt.txt' } : 'test', retain_response: true };
    const values = [];
    for await (const value of capability.stream!(payload, { signal })) values.push(value);
    assert.equal(values.filter(value => (value as { type: string }).type === 'text')
      .map(value => (value as { text: string }).text).join(''), output);
    output += 'x';
    for (const request of [payload, { ...payload, max_response_bytes: 999999 }]) {
      await assert.rejects(async () => {
        for await (const value of capability.stream!(request, { signal })) void value;
      }, /limit/i);
    }
    assert.equal(closed, 3);
  }
});

test('retained response limits count empty events and delivered fragments before yielding', async () => {
  for (const fragmented of [false, true]) {
    let closed = 0;
    const service = createLlmService({ defaultModel: 'm', providers: [{
      name: 'test', models: [{ id: 'm' }],
      async *complete() {
        try {
          if (fragmented) yield 'é'.repeat(4);
          else for (let index = 0; index < 4; index++) yield '';
        } finally { closed++; }
      },
    }] });
    const capability = createPythonLlmCapability(context, service, {
      maxBufferedResponseBytes: 128, maxBufferedEvents: 3, maxStreamChunkBytes: 2,
    });
    let received = 0;
    await assert.rejects(async () => {
      for await (const value of capability.stream!({ retain_response: true }, { signal })) {
        assert.equal((value as { type: string }).type, 'text');
        received++;
      }
    }, /event limit/i);
    assert.equal(received, 3);
    assert.equal(closed, 1);
  }
});

test('retained response mode rejects invalid flags before acquiring provider output', async () => {
  let calls = 0;
  const service = createLlmService({ defaultModel: 'm', providers: [{
    name: 'test', models: [{ id: 'm' }],
    async *complete() { calls++; yield 'ok'; },
  }] });
  const capability = createPythonLlmCapability(context, service);
  for (const retain_response of [null, 1, 'true']) {
    await assert.rejects(async () => {
      for await (const value of capability.stream!({ retain_response }, { signal })) void value;
    }, /retained response/i);
  }
  assert.equal(calls, 0);
});
