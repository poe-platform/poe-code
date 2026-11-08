import {deflateRawSync,deflateSync,gzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createByteCodec} from './index.js';

for (const format of ['raw','zlib','gzip'] as const) for (const direction of ['encode','decode'] as const) {
 it(`stops a suspended ${format} ${direction} iterator when its codec is closed`, () => {
  const plain=Uint8Array.from({length:4096},(_,i)=>i%251);
  const input=direction==='encode'?plain:format==='raw'?deflateRawSync(plain):format==='zlib'?deflateSync(plain):gzipSync(plain);
  const codec=createByteCodec({direction,format,chunkSize:7});
  const iterator=codec.push(input,true);
  const first=iterator.next();expect(first.done).toBe(false);
  const owned=first.value!.slice();
  codec.close();
  expect(()=>iterator.next()).toThrow('codec is closed');
  expect(first.value).toEqual(owned);
  expect(codec.complete).toBe(false);
  expect(()=>codec.push(input,true).next()).toThrow('codec is closed');
  codec.close();
 });
}

it('allows returning a suspended iterator after explicit codec close', () => {
 const codec=createByteCodec({direction:'decode',format:'gzip',chunkSize:1});
 const iterator=codec.push(gzipSync('payload'),true);
 expect(iterator.next().done).toBe(false);
 codec.close();
 expect(iterator.return(undefined).done).toBe(true);
});

for (const format of ['raw','zlib','gzip'] as const) it(`does not report ${format} completion after close interrupts the final yield`, () => {
 const codec=createByteCodec({direction:'encode',format,chunkSize:65536});
 const iterator=codec.push(Uint8Array.of(1),true);
 expect(iterator.next().done).toBe(false);
 codec.close();
 expect(()=>iterator.next()).toThrow('codec is closed');
 expect(codec.complete).toBe(false);
});
