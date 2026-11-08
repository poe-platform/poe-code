import {expect, it} from 'vitest';
import {createCompressionCodec} from './index.js';

it('does not deliver an in-flight chunk after reader close starts', async () => {
 let release!: (value: IteratorResult<Uint8Array>) => void;
 let entered!: () => void;
 const reading = new Promise<void>(resolve => {entered = resolve;});
 let returned = 0;
 const source = {[Symbol.asyncIterator]() {return {
  next() {entered(); return new Promise<IteratorResult<Uint8Array>>(resolve => {release = resolve;});},
  async return() {returned++; return {done:true as const, value:undefined};},
 };}};
 const {CodecReader} = createCompressionCodec();
 const reader = new CodecReader(source, new AbortController().signal);
 const chunk = reader.chunk(); await reading;
 const closing = reader.close();
 release({done:false, value:Uint8Array.of(1,2,3)});
 expect(await chunk).toBeUndefined();
 await closing;
 expect(returned).toBe(1);
 expect(await reader.chunk()).toBeUndefined();
 await reader.close(); expect(returned).toBe(1);
});

it('preserves a read failure while close waits for the source', async () => {
 let fail!: (reason: unknown) => void;
 let entered!: () => void;
 const reading = new Promise<void>(resolve => {entered = resolve;});
 const failure = new Error('remote read failed');
 const source = {[Symbol.asyncIterator]() {return {
  next() {entered(); return new Promise<IteratorResult<Uint8Array>>((_resolve,reject) => {fail = reject;});},
 };}};
 const {CodecReader} = createCompressionCodec();
 const reader = new CodecReader(source, new AbortController().signal);
 const chunk = reader.chunk(); const rejected = expect(chunk).rejects.toBe(failure); await reading;
 const closing = reader.close(); fail(failure);
 await rejected; await closing;
});

it('checks caller cancellation after an injected runtime delivers a chunk', async () => {
 const {defaultRuntime} = await import('./index.js');
 const controller = new AbortController(), failure = new Error('cancelled');
 const {CodecReader} = createCompressionCodec({...defaultRuntime,
  async *readBytes() {controller.abort(failure); yield Uint8Array.of(1);},
 });
 const reader = new CodecReader({async *[Symbol.asyncIterator](){}}, controller.signal);
 await expect(reader.chunk()).rejects.toBe(failure);
 await reader.close();
});
