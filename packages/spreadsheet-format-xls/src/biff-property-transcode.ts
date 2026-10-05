import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import type { BiffPropertyRange } from './biff-property-range.js';
import { stagePropertyBytes } from './biff-property-bytes.js';
import type { BiffPropertySource } from './biff-encrypted-properties-write.js';

/** Count UTF-16 units before staging; both passes retain only a bounded decoder window. */
export async function stageWideBiffProperty(source: BiffPropertyRange, context: CapabilityContext,
  charge: (amount: number) => void, reserve: (length: number) => number): Promise<BiffPropertySource> {
  reserve(source.size);
  const text = source.slice(8, await source.u32(4) - 1);
  const parts = async function* (): AsyncIterable<string> {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    for (let at = 0; at < text.size;) {
      const bytes = await text.read(at, Math.min(8192, text.size - at)); at += bytes.length;
      try { yield decoder.decode(bytes, { stream: true }); } finally { bytes.fill(0); }
    }
    yield decoder.decode();
  };
  let units = 0;
  for await (const part of parts()) units += part.length;
  charge(units); const length = reserve(8 + (units + 1) * 2);
  return stagePropertyBytes({ length, async *chunks() {
    const header = new Uint8Array(8), view = new DataView(header.buffer);
    view.setUint32(0, 31, true); view.setUint32(4, units + 1, true); yield header;
    const buffer = new Uint8Array(16384), output = new DataView(buffer.buffer);
    try {
      for await (const part of parts()) for (let at = 0; at < part.length; at += 8192) {
        const size = Math.min(8192, part.length - at);
        for (let i = 0; i < size; i++) output.setUint16(i * 2, part.charCodeAt(at + i), true);
        yield buffer.subarray(0, size * 2);
      }
      yield new Uint8Array(2);
    } finally { buffer.fill(0); }
  } }, context);
}
