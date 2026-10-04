import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import {createCommandArguments} from 'safe-bash-contracts';
import {bindFileOutputBudget} from 'safe-bash-contracts/filesystem-output-budget';
import {createMikeYqCommand} from './mike.js';

for (const split of [false, true]) for (const cancel of [false, true]) test(`streams encoded YQ output (split=${split}, cancel=${cancel})`, async () => {
 const fs = createMemoryFileSystem(), controller = new AbortController(), reason = new Error('stopped');
 const text = 'a'.repeat(4095) + '😀é'.repeat(20000), chunks: Uint8Array[] = [];
 let largest = 0, opened = 0, closed = 0, registrations = 0;
 const check = (bytes: Uint8Array) => {
  largest = Math.max(largest, bytes.length);
  assert.ok(bytes.length <= 16384, 'encoded output must be bounded');
  chunks.push(bytes.slice());
  if (cancel) controller.abort(reason);
 };
 const filesystem = new Proxy(fs, {get(target,key) {
  if (key === 'writeFile') return () => {assert.fail('split output must use retained descriptor writes');};
  if (key === 'open') return async (...args: Parameters<typeof fs.open>) => {
   const descriptor = await fs.open(...args); opened++;
   return new Proxy(descriptor, {get(handle, member) {
    if (member === 'write') return async (...writeArgs: Parameters<typeof descriptor.write>) => {check(writeArgs[0]); return descriptor.write(...writeArgs);};
    if (member === 'close') return async () => {closed++; await descriptor.close();};
    const value = Reflect.get(handle,member,handle); return typeof value === 'function' ? value.bind(handle) : value;
   }});
  };
  const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
 }});
 const args = split ? ['-n','--split-exp','"result"','strenv(TEXT)'] : ['-n','strenv(TEXT)'];
 const result = Promise.resolve(createMikeYqCommand().execute({command:'yq', ...createCommandArguments(args), cwd:'/', env:{TEXT:text}, fs:filesystem, signal:controller.signal,
  registerCleanup(){registrations++;}, stdin:{async *[Symbol.asyncIterator](){}}, stdout:{async write(bytes){assert.equal(split,false); check(bytes);}}, stderr:{async write(){}}}));
 if (cancel) await assert.rejects(result, error => error === reason);
 else {
  assert.equal((await result).exitCode,0);
  const decoder = new TextDecoder(); let actual = '';
  for (const bytes of chunks) actual += decoder.decode(bytes,{stream:true}); actual += decoder.decode();
  assert.equal(actual,text+'\n');
 }
 assert.ok(largest > 0); assert.equal(closed,opened); assert.equal(opened,split ? 1 : 0);
 assert.ok(registrations <= 2, 'cleanup ownership must not grow with output chunks');
});

for (const reject of [false, true]) test(`split output preserves invocation budget (reject=${reject})`, async () => {
 const fs = createMemoryFileSystem(), reason = new Error('budget exceeded');
 const context = { registerCleanup: (_cleanup: () => Promise<void> | void) => {} };
 let charged = 0;
 bindFileOutputBudget(context, sink => sink, async (bytes, write) => {charged += bytes.length; if (reject) throw reason; return write();});
 const result = Promise.resolve(createMikeYqCommand().execute({command:'yq', ...createCommandArguments(['-n','--split-exp','"result"','42']), cwd:'/', env:{}, fs, ...context,
  signal:new AbortController().signal, stdin:{async *[Symbol.asyncIterator](){}}, stdout:{async write(){assert.fail();}}, stderr:{async write(){}}}));
 if (reject) await assert.rejects(result, error => error === reason);
 else assert.equal((await result).exitCode, 0);
 assert.equal(charged, 3);
 assert.equal(new TextDecoder().decode(await fs.readFile('/result.yml')), reject ? '' : '42\n');
});
