import {transformBytes} from "@poe-code/compression";
export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(typeBytes: Uint8Array, data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < typeBytes.length; i++) {
    c = CRC_TABLE[(c ^ typeBytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}


export function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3)
  ]);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(typeBytes, data), false);
  if (type === "IDAT" && data.byteOffset === 0 && typeof (data.buffer as any).transfer === "function") {
    try { (data.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  }
  return out;
}

export function canvasChunk(canvas: { width: number; height: number; x: number; y: number }): Uint8Array {
  const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
  view.setUint32(0, canvas.width); view.setUint32(4, canvas.height);
  view.setInt32(8, canvas.x); view.setInt32(12, canvas.y);
  return makeChunk("caNv", bytes);
}

export function* textChunks(properties: Readonly<Record<string, string>> | undefined): Generator<Uint8Array> {
  for (const [key, value] of Object.entries(properties ?? {})) {
    const keyword = Uint8Array.from(key, char => char.charCodeAt(0));
    if (!key.length || key.length > 79 || [...key].some(char => char.charCodeAt(0) > 255 || char === "\0")) continue;
    const text = new TextEncoder().encode(value), payload = new Uint8Array(keyword.length + 5 + text.length);
    payload.set(keyword); payload.set(text, keyword.length + 5);
    yield makeChunk("iTXt", payload);
  }
}

export function iccChunk(icc: Uint8Array): Uint8Array {
  const compressed = transformBytes(icc, {direction:"encode",format:"zlib"});
  const payload = new Uint8Array(5 + compressed.length);
  payload.set([73, 67, 67, 0, 0]);
  payload.set(compressed, 5);
  return makeChunk("iCCP", payload);
}

export function gammaChunk(gamma: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Math.round(gamma * 100000));
  return makeChunk("gAMA", bytes);
}
