import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import {createCommandArguments} from 'safe-bash-contracts';
import {createMikeYqCommand} from './mike.js';
import {NativeWork, limitsFor} from './native-work.js';

for (const mode of ['complete', 'sink-limit', 'cancel'] as const) test(`exhausted work budget keeps diagnostic output bounded and respects ${mode}`, async () => {
 const controller = new AbortController(), failure = new Error(mode), chunks: Uint8Array[] = [];
 const work = new NativeWork({command:'yq', ...createCommandArguments([]), cwd:'/', env:{}, fs:createMemoryFileSystem(), signal:controller.signal,
  stdin:{async *[Symbol.asyncIterator](){}}, stdout:{async write(){assert.fail();}}, stderr:{async write(bytes){
   assert.ok(bytes.length <= 12288, 'diagnostics must use bounded UTF-8 chunks');
   chunks.push(new Uint8Array(bytes));
   if (chunks.length === 2 && mode === 'sink-limit') throw failure;
   if (chunks.length === 2 && mode === 'cancel') controller.abort(failure);
  }}}, limitsFor({maxSteps:1}));
 work.tick();
 assert.throws(() => work.tick(), /maxSteps/u);
 const message = `${'a'.repeat(4095)}🌊${'é'.repeat(9000)}`;
 try {
  const writing = work.write(message, true);
  if (mode === 'complete') {
   await writing;
   assert.equal(chunks.map(chunk => new TextDecoder().decode(chunk)).join(''), message);
  } else {
   await assert.rejects(writing, error => error === failure);
   assert.equal(chunks.length, 2);
  }
 } finally { await work.close(); }
});

test('split output cleanup ownership stays bounded across completed files', async () => {
 const fs = createMemoryFileSystem();
 let registered = 0;
 const cleanups: (() => void | Promise<void>)[] = [];
 const result = await createMikeYqCommand().execute({command:'yq', ...createCommandArguments(['-n','--split-exp','"result"',JSON.stringify(Array.from({length:100}, (_,i) => i)) + ' | .[]']), cwd:'/', env:{}, fs,
  signal:new AbortController().signal, registerCleanup(cleanup){registered++; assert.ok(registered <= 2, 'completed split files retain shell cleanup registrations'); cleanups.push(cleanup);},
  stdin:{async *[Symbol.asyncIterator](){}}, stdout:{async write(){assert.fail();}}, stderr:{async write(bytes){assert.fail(new TextDecoder().decode(bytes));}}});
 assert.equal(result.exitCode, 0);
 assert.equal(new TextDecoder().decode(await fs.readFile('/result.yml')), '99\n');
 for (const cleanup of cleanups) await cleanup();
});

for (const mode of ['late-cancel', 'close-failure'] as const) test(`split output retires owned descriptors on ${mode}`, async () => {
 const {NativeWork, limitsFor} = await import('./native-work.js');
 const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error(mode);
 let signalOpened!: () => void, release!: () => void, closed = 0;
 const opened = new Promise<void>(resolve => {signalOpened = resolve;});
 const held = new Promise<void>(resolve => {release = resolve;});
 const filesystem = new Proxy(fs, {get(target, key) {
  if (key === 'open') return async (...args: Parameters<typeof fs.open>) => {
   const descriptor = await fs.open(...args); signalOpened();
   if (mode === 'late-cancel') await held;
   return new Proxy(descriptor, {get(handle, member) {
    if (member === 'close') return async () => {closed++; await descriptor.close(); if (mode === 'close-failure') throw failure;};
    const value = Reflect.get(handle, member, handle); return typeof value === 'function' ? value.bind(handle) : value;
   }});
  };
  const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
 }});
 const work = new NativeWork({command:'yq', ...createCommandArguments([]), cwd:'/', env:{}, fs:filesystem, signal:controller.signal,
  stdin:{async *[Symbol.asyncIterator](){}}, stdout:{async write(){assert.fail();}}, stderr:{async write(){assert.fail();}}}, limitsFor());
 const writing = work.writeFile('/result.yml','value\n');
 const rejected = assert.rejects(writing, error => error === failure);
 await opened;
 if (mode === 'late-cancel') {controller.abort(failure); release();}
 await rejected; await work.close();
 assert.equal(closed,1);
});
