import { expect, it, vi } from 'vitest';
import { createFrameJournal } from './journal.js';
const options = { maxFrameBytes: 8, maxControlBytes: 8, channels: [2], maxReplayBytes: 172 };
it('reserves control credit and schedules it before data waiting for acknowledgement', async () => {
 const journal=createFrameJournal({...options,maxReplayBytes:96,validateControl(){}});
 await journal.append('data',2,new Uint8Array(8));
 let dataPublished=false;let controlPublished=false;
 const data=journal.append('data',2,new Uint8Array(8)).then(()=>{dataPublished=true;});
 const control=journal.append('control',0,new TextEncoder().encode('{}')).then(()=>{controlPublished=true;});
 try {
  for(let turn=0;turn<12;turn++)await Promise.resolve();
  expect({dataPublished,controlPublished}).toEqual({dataPublished:false,controlPublished:true});
  expect(journal.retainedBytes).toBe(90);expect(journal.next).toBe(3n);
  const reader=journal.stream(2n).getReader();
  try{expect((await reader.read()).value?.[5]).toBe(3);}finally{await reader.cancel();}
  journal.ack(2n);await data;expect(journal.next).toBe(4n);
 }finally{journal.fail(new Error('fixture retired'));await Promise.allSettled([data,control]);}
});
it('bounds control retention without borrowing data credit or reordering emitted sequences', async () => {
 const journal=createFrameJournal({...options,maxReplayBytes:96,validateControl(){}});
 const payload=new TextEncoder().encode('{}');
 await journal.append('control',0,payload);
 let published=false;
 const blocked=journal.append('control',0,payload).then(()=>{published=true;});
 try {
  await expect(journal.append('data',2,new Uint8Array(8))).resolves.toBe(2n);
  expect(published).toBe(false);expect(journal.retainedBytes).toBe(90);
  journal.ack(1n);await blocked;expect(journal.next).toBe(4n);
  const reader=journal.stream(2n).getReader();
  try {
   const data=(await reader.read()).value!;const control=(await reader.read()).value!;
   expect(new DataView(data.buffer).getBigUint64(16)).toBe(2n);
   expect(new DataView(control.buffer).getBigUint64(16)).toBe(3n);
   expect(data[5]).toBe(1);expect(control[5]).toBe(3);
  }finally{await reader.cancel();}
 }finally{journal.fail(new Error('fixture retired'));await Promise.allSettled([blocked]);}
});
it('rejects the actual payload span before retaining bytes or reading shadowed lengths',async()=>{
 const journal=createFrameJournal(options);const bytes=new Uint8Array(9);const length=vi.fn(()=>1);
 Object.defineProperty(bytes,'length',{get:length});
 await expect(journal.append('data',2,bytes)).rejects.toThrow('Frame exceeds admission');
 expect(length).not.toHaveBeenCalled();expect(journal.retainedBytes).toBe(0);expect(journal.next).toBe(1n);
 await expect(journal.append('data',2,Uint8Array.of(7))).resolves.toBe(1n);
 journal.seal();
});
it('keeps acknowledged replay capacity independent of caller mutation', async () => {
  const admission = { ...options, channels: [2], maxReplayBytes: 96 };
  const journal = createFrameJournal(admission);
  await journal.append('data', 2, new Uint8Array(8));
  admission.maxReplayBytes = 1000;
  admission.maxFrameBytes = 1000;
  let published = false;
  const blocked = journal.append('data', 2, Uint8Array.of(9)).then(() => { published = true; });
  // Let the append reach its retained-credit wait without using a timer.
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  const beforeAck = { published, bytes: journal.retainedBytes, next: journal.next };
  journal.ack(1n);
  await blocked;
  expect(beforeAck).toEqual({ published: false, bytes: 48, next: 2n });
  await expect(journal.append('data', 2, new Uint8Array(9))).rejects.toThrow('Frame exceeds admission');
  journal.seal();
});
it('refuses an expired acknowledgment even when channel cursors are omitted', async () => {
  const journal = createFrameJournal(options);
  await journal.append('data', 2, Uint8Array.of(1));
  journal.ack(1n);
  await journal.append('data', 2, Uint8Array.of(2));
  journal.ack(2n);
  expect(() => journal.ack(1n)).toThrow('Acknowledgement replay gap');
  expect(() => journal.ack(2n)).not.toThrow();
  expect(journal.floor).toBe(3n);
});
it('validates a lost acknowledgment reply against the retired delivery boundary', async () => {
  const journal = createFrameJournal(options);
  await journal.append('data', 2, Uint8Array.of(7));
  journal.ack(1n, [{channelId:2,offset:'1'}]);
  expect(() => journal.validateAck(1n, [{channelId:2,offset:'1'}])).not.toThrow();
  expect(() => journal.validateAck(1n, [{channelId:2,offset:'0'}])).toThrow('offsets conflict');
  expect(journal.retainedBytes).toBe(0);
  expect(journal.floor).toBe(2n);
});
it('reports an expired acknowledgment cursor rather than confirming unverifiable delivery', async () => {
  const journal = createFrameJournal(options);
  await journal.append('data', 2, Uint8Array.of(7));
  journal.ack(1n);
  await journal.append('data', 2, Uint8Array.of(8));
  journal.ack(2n);
  expect(() => journal.validateAck(1n, [{channelId:2,offset:'1'}])).toThrow('replay gap');
  try { journal.validateAck(1n, [{channelId:2,offset:'1'}]); }
  catch (error) { expect(error).toMatchObject({status:410}); }
  expect(journal.retainedBytes).toBe(0);
});
it.each(['data', 'end'] as const)('does not publish %s when cancellation races acknowledged credit', async kind => {
  const journal = createFrameJournal({ ...options, maxReplayBytes: 96 });
  await journal.append('data', 2, new Uint8Array(8));
  const controller = new AbortController();
  const reason = new Error('invocation deadline');
  const blocked = journal.append(kind, 2, new Uint8Array(), 0n, controller.signal);
  // Let the producer enter its credit wait, then wake it before aborting in
  // the same deterministic turn. The resumed producer must recheck admission.
  await Promise.resolve();
  journal.ack(1n);
  controller.abort(reason);
  await expect(blocked).rejects.toBe(reason);
  expect(journal.next).toBe(2n);
  expect(journal.retainedBytes).toBe(0);
  expect(journal.channelsEnded).toBe(false);
  await journal.append('data', 2, Uint8Array.of(7));
  const reader = journal.stream(2n).getReader();
  expect((await reader.read()).value?.[40]).toBe(7);
  await reader.cancel();
  journal.seal();
});
it('owns Buffer payloads while replay capacity delays their encoding', async () => {
  const journal = createFrameJournal({ ...options, maxReplayBytes: 96 });
  await journal.append('data', 2, new Uint8Array(8));
  const producer = Buffer.from([7]);
  const blocked = journal.append('data', 2, producer);
  producer.fill(99);
  journal.ack(1n); await blocked;
  const reader = journal.stream(2n).getReader();
  try { expect((await reader.read()).value?.[40]).toBe(7); }
  finally { await reader.cancel(); journal.seal(); }
});
it('owns queued payloads before returning admission to a concurrent caller', async () => {
 const journal=createFrameJournal(options);const bytes=new Uint8Array([7]);const pending=journal.append('data',2,bytes);bytes[0]=99;await pending;
 const reader=journal.stream(1n).getReader();expect((await reader.read()).value?.[40]).toBe(7);await reader.cancel();journal.seal();
});
it('bounds retained bytes, blocks a producer until ack and copies reused buffers', async () => {
  const journal = createFrameJournal(options); const bytes = new Uint8Array([0, 255, 128]);
  await journal.append('data', 2, bytes); bytes[0] = 9; await journal.append('data', 2, bytes);
  let produced = false; const blocked = journal.append('data', 2, bytes).then(() => { produced = true; });
  await Promise.resolve(); expect(produced).toBe(false);
  const reader = journal.stream(1n).getReader(); const first = await reader.read(); expect(first.value?.[40]).toBe(0);
  expect(() => journal.ack(3n)).toThrow(); journal.ack(1n); await blocked; expect(produced).toBe(true);
  expect(() => journal.stream(1n)).toThrow('replay'); await reader.cancel(); journal.fail(new Error('stop'));
});
it('resumes exact frames and ends only when the journal seals', async () => {
  const journal = createFrameJournal({ ...options, maxReplayBytes: 1000 });
  await journal.append('data', 2, new Uint8Array([1])); await journal.append('end', 2, new Uint8Array()); journal.seal();
  const read = journal.stream(2n).getReader(); expect((await read.read()).value?.[5]).toBe(2); expect((await read.read()).done).toBe(true);
  expect(() => journal.ack(0n)).not.toThrow(); expect(() => journal.stream(4n)).toThrow();
});
it('admits a negotiated channel before data and rejects unknown channels',async()=>{
 const journal=createFrameJournal({...options,maxReplayBytes:1000});
 await expect(journal.append('data',4,new Uint8Array([1]))).rejects.toThrow();
 journal.openChannel(4);await journal.append('data',4,new Uint8Array([128]));expect(journal.next).toBe(2n);
});
