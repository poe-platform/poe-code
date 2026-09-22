import { describe, expect, it, vi } from 'vitest';
import { decodeFrames, encodeFrame, type BinaryFrame } from './binary.js';
const frame: BinaryFrame = { kind: 'data', channelId: 2, sequence: 1n, offset: 0n, correlationId: 0n, payload: new Uint8Array([0, 255, 128]) };
const options = { maxFrameBytes: 8, maxControlBytes: 8, channels: [2, 3] };
async function collect(chunks: Uint8Array[], settings = options) {
  const source = new ReadableStream<Uint8Array>({ start(c) { for (const b of chunks) c.enqueue(b); c.close(); } });
  const result = []; for await (const f of decodeFrames(source, settings)) result.push(f); return result;
}
describe('version 1 binary framing', () => {
  it('releases the transport when its initial sequence is inadmissible', async () => {
    const source = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    await expect(decodeFrames(source, { ...options, firstSequence: -1n }).next()).rejects.toThrow('uint64');
    expect(source.locked).toBe(false);
  });
  it('refuses an overflowing encoded channel offset', () => {
    expect(() => encodeFrame({ ...frame, offset: 18446744073709551615n }, options)).toThrow('Channel offset overflow');
  });
  it('retains the admitted lane byte budget while the transport is pending', async () => {
    const settings = { ...options, maxTotalBytes: 40 };
    let transport!: ReadableStreamDefaultController<Uint8Array>;
    const source = new ReadableStream<Uint8Array>({ start(controller) { transport = controller; } });
    const iterator = decodeFrames(source, settings);
    const pending = iterator.next();
    settings.maxTotalBytes = 1024;
    transport.enqueue(encodeFrame(frame, options)); transport.close();
    await expect(pending).rejects.toThrow('Lane byte length exceeds admission');
    expect(source.locked).toBe(false);
  });
  it('retains required END settlement while the consumer delivers a frame', async () => {
    const settings = { ...options, channels: [2], requireEnd: true };
    const source = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encodeFrame(frame, options)); controller.close();
    } });
    const iterator = decodeFrames(source, settings);
    expect((await iterator.next()).value).toEqual(frame);
    settings.requireEnd = false;
    await expect(iterator.next()).rejects.toThrow('Transport EOF without END');
    expect(source.locked).toBe(false);
  });
  it('retains control validation and descriptor capacity before transport reads', async () => {
    const channel = { type: 'ChannelOpen', channelId: 4, direction: 'write' };
    const validateControl = vi.fn();
    const replacement = vi.fn();
    const settings = { maxFrameBytes: 256, maxControlBytes: 256, channels: [2], maxChannels: 1,
      channelOpenDirection: 'write' as const, validateControl };
    let transport!: ReadableStreamDefaultController<Uint8Array>;
    const source = new ReadableStream<Uint8Array>({ start(controller) { transport = controller; } });
    const pending = decodeFrames(source, settings).next();
    settings.maxChannels = 2; settings.validateControl = replacement;
    transport.enqueue(encodeFrame({ ...frame, kind: 'control', channelId: 0,
      payload: new TextEncoder().encode(JSON.stringify(channel)) }, { ...settings, validateControl() {} }));
    transport.close();
    await expect(pending).rejects.toThrow('Invalid dynamic channel admission');
    expect(validateControl).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
    expect(source.locked).toBe(false);
  });
  it('admits the actual payload span before encoding and ignores shadowed byte lengths',()=>{
    const payload=Uint8Array.of(0,255,128);const length=vi.fn(()=>0);
    Object.defineProperty(payload,'length',{get:length});
    const wire=encodeFrame({...frame,payload},options);
    expect(wire.slice(40)).toEqual(Uint8Array.of(0,255,128));
    expect(new DataView(wire.buffer).getUint32(12)).toBe(3);expect(length).not.toHaveBeenCalled();
    const oversized=new Uint8Array(9);Object.defineProperty(oversized,'length',{get:length});
    expect(()=>encodeFrame({...frame,payload:oversized},options)).toThrow('Invalid frame length');
    expect(length).not.toHaveBeenCalled();
  });
  it('decodes transport octets without trusting replaceable length and slicing methods',async()=>{
    const wire=encodeFrame(frame,options);const length=vi.fn(()=>0);const subarray=vi.fn(()=>new Uint8Array());
    Object.defineProperty(wire,'length',{get:length});wire.subarray=subarray;
    expect(await collect([wire])).toEqual([frame]);
    expect(length).not.toHaveBeenCalled();expect(subarray).not.toHaveBeenCalled();
  });
  it('preserves arbitrary octets and bigint correlation across every header split', async () => {
    const input = { ...frame, correlationId: 18446744073709551615n };
    const wire = encodeFrame(input, options);
    for (let i = 1; i < wire.length; i++) expect(await collect([wire.slice(0, i), wire.slice(i)])).toEqual([input]);
  });
  it('copies a retained frame before the producer reuses its payload', () => {
    const input = { ...frame, payload: new Uint8Array([1]) }; const wire = encodeFrame(input, options);
    input.payload[0] = 9; expect(wire[40]).toBe(1);
  });
  it('rejects oversized headers before waiting for or allocating payload', async () => {
    const wire = encodeFrame(frame, options).slice(0, 40); new DataView(wire.buffer).setUint32(12, 1048577);
    await expect(collect([wire])).rejects.toThrow('length');
  });
  it.each([0, 4, 6, 8, 16, 24])('rejects corrupted field at %s', async index => {
    const wire = encodeFrame(frame, options); wire[index] ^= 127;
    await expect(collect([wire])).rejects.toThrow();
  });
  it('distinguishes transport EOF from explicit channel END', async () => {
    const wire = encodeFrame(frame, options);
    await expect(collect([wire.slice(0, -1)])).rejects.toThrow('Interrupted');
    await expect(collect([wire], { ...options, requireEnd: true })).rejects.toThrow('END');
    expect(await collect([wire, encodeFrame({ ...frame, kind: 'end', sequence: 2n, offset: 3n, payload: new Uint8Array() }, options)], { ...options, channels: [2], requireEnd: true })).toHaveLength(2);
  });
  it('rejects duplicate END, data after END, sequence gaps and channel offset gaps', async () => {
    const end = { ...frame, kind: 'end' as const, payload: new Uint8Array() };
    for (const next of [{ ...end, sequence: 2n }, { ...frame, sequence: 2n }, { ...frame, sequence: 3n }]) {
      await expect(collect([encodeFrame(end, options), encodeFrame(next, options)])).rejects.toThrow();
    }
    await expect(collect([encodeFrame(frame, options), encodeFrame({ ...frame, sequence: 2n }, options)])).rejects.toThrow('offset');
  });
  it('validates empty DATA and END rather than treating zero bytes as EOF', async () => {
    expect(await collect([encodeFrame({ ...frame, payload: new Uint8Array() }, options)])).toHaveLength(1);
    expect(() => encodeFrame({ ...frame, kind: 'end' }, options)).toThrow();
  });
  it('rejects malformed UTF-8 and unknown control fields', async () => {
    const limits = { maxFrameBytes: 256, maxControlBytes: 256, channels: [2], validateControl(value: unknown) {
      if (!value || typeof value !== 'object' || Object.keys(value).join() !== 'type' || (value as { type: string }).type !== 'test') throw new TypeError('Invalid control');
    } };
    for (const payload of [new Uint8Array([255]), new TextEncoder().encode('{"type":"test","extra":true}')]) {
      const input = { ...frame, kind: 'control' as const, channelId: 0, payload };
      expect(() => encodeFrame(input, limits)).toThrow();
    }
  });
  it('rejects repeated and escaped-alias JSON control keys before schema dispatch',()=>{
    let dispatched=0;
    const settings={maxFrameBytes:256,maxControlBytes:256,channels:[2],validateControl(){dispatched++;}};
    for(const json of ['{"type":"Ack","type":"ChannelOpen"}','{"type":"Ack","offsets":[{"offset":"1","off\\u0073et":"2"}]}']){
      expect(()=>encodeFrame({...frame,kind:'control',channelId:0,payload:new TextEncoder().encode(json)},settings)).toThrow('Duplicate');
    }
    expect(dispatched).toBe(0);
  });
});
it('admits only bounded explicitly negotiated dynamic channels and requires their END',async()=>{
 const channel={type:'ChannelOpen',channelId:4,correlationId:'1',direction:'write',resourceId:'handle',seekable:false};
 const settings={maxFrameBytes:256,maxControlBytes:256,channels:[2],maxChannels:2,channelOpenDirection:'write' as const,validateControl(value:unknown){if((value as typeof channel).type!=='ChannelOpen')throw new TypeError('control');}};
 const open=encodeFrame({...frame,kind:'control',channelId:0,sequence:1n,payload:new TextEncoder().encode(JSON.stringify(channel))},settings);
 const data=encodeFrame({...frame,channelId:4,sequence:2n,correlationId:1n}, {...settings,channels:[2,4]});
 const source=new ReadableStream<Uint8Array>({start(c){c.enqueue(open);c.enqueue(data);c.close();}});const found=[];for await(const f of decodeFrames(source,settings))found.push(f);expect(found[1].channelId).toBe(4);
 const bounded=new ReadableStream<Uint8Array>({start(c){c.enqueue(open);c.close();}});await expect((async()=>{for await(const ignoredFrame of decodeFrames(bounded,{...settings,maxChannels:1})){void ignoredFrame;} })()).rejects.toThrow('channel');
});
