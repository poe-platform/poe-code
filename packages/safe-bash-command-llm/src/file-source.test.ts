import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { fileSource } from './file-source.js';

test('retained attachment streams every byte including tail without whole-file reads', async () => {
  const backing = new MemoryFileSystem();
  const size = 16 * 1024 * 1024 + 7;
  await backing.writeFile('/attachment', new Uint8Array(size).fill(97));
  let largestRead = 0, closes = 0;
  const fs = new Proxy(backing, {get(target, key) {
    if (key === 'readFile') return () => {throw new Error('whole-file read prohibited');};
    if (key === 'openReadFile') return async (...args: Parameters<typeof target.openReadFile>) => {
      const reader = await target.openReadFile(...args);
      return {stat: reader.stat.bind(reader), async close() {closes++; await reader.close();},
        async read(position: number, count: number, options: Parameters<typeof reader.read>[2]) {
          largestRead = Math.max(largestRead, count); return reader.read(position, count, options);
        }};
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const source = await fileSource({fs, path:'/attachment', signal: new AbortController().signal});
  let received = 0;
  for await (const bytes of source.bytes) {assert.ok(bytes.byteLength <= 16384); assert.equal(bytes[0], 97); assert.equal(bytes.at(-1), 97); received += bytes.byteLength;}
  await source.dispose(); await source.dispose();
  assert.deepEqual({received,largestRead,closes}, {received:size,largestRead:16384,closes:1});
});

test('retained attachment detects mutation before emitting changed bytes', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/attachment', new Uint8Array(32768).fill(97));
  const source = await fileSource({fs,path:'/attachment',signal:new AbortController().signal});
  const iterator = source.bytes[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value?.byteLength, 16384);
  await fs.writeFile('/attachment', new Uint8Array(32768).fill(98));
  await assert.rejects(iterator.next(), /attachment changed/);
  await source.dispose();
});

test('disposing a lease independently of a stalled read prevents late bytes', async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile('/attachment', Uint8Array.of(97));
  let started!: () => void, finish!: (value: Uint8Array) => void, closes = 0;
  const admitted = new Promise<void>(resolve => {started = resolve;});
  const fs = new Proxy(backing, {get(target, key) {
    if (key === 'openReadFile') return async (...args: Parameters<typeof target.openReadFile>) => {
      const reader = await target.openReadFile(...args);
      return {stat: reader.stat.bind(reader), async close() {closes++; await reader.close();},
        read() {started(); return new Promise<Uint8Array>(resolve => {finish = resolve;});}};
    };
    const value = Reflect.get(target,key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const source = await fileSource({fs,path:'/attachment',signal:new AbortController().signal});
  const pending = source.bytes[Symbol.asyncIterator]().next();
  await admitted;
  await source.dispose();
  assert.equal(closes,1);
  const rejected = assert.rejects(pending,/source is closed/);
  finish(Uint8Array.of(97));
  await rejected;
});

test('retained-read capability and known byte limit reject before opening', async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile('/attachment',new Uint8Array(32));
  let opens = 0;
  const fs = new Proxy(backing,{get(target,key) {
    if (key === 'openReadFile') return () => {opens++; throw new Error('must not open');};
    const value = Reflect.get(target,key);return typeof value === 'function' ? value.bind(target) : value;
  }});
  await assert.rejects(fileSource({fs,path:'/attachment',signal:new AbortController().signal,maxBytes:31}),/input byte limit/);
  const unsupported = new Proxy(fs,{get(target,key) {
    if (key === 'capabilitiesFor') return async () => ({...backing.capabilities,retainedRead:false});
    return Reflect.get(target,key);
  }});
  await assert.rejects(fileSource({fs:unsupported,path:'/attachment',signal:new AbortController().signal}),/require retained reads/);
  assert.equal(opens,0);
});

test('admission rejects mutation between CLI size accounting and lease acquisition', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/attachment', Uint8Array.of(97));
  const expectedStat = await fs.stat('/attachment');
  await fs.writeFile('/attachment', Uint8Array.of(98, 99));
  await assert.rejects(fileSource({ fs, path: '/attachment', signal: new AbortController().signal, expectedStat }), /attachment changed/);
});
