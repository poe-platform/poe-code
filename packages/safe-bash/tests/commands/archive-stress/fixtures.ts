import { createHash } from "node:crypto";

export const epochSeconds = 1_700_123_456;
export const longName = `report-${"segment".repeat(18)}-雪.bin`;

export function pattern(length: number, seed = 0x12345678): Buffer {
  let state = seed >>> 0;
  return Buffer.from(Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 255;
  }));
}

export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface Entry {
  name: string;
  data?: Uint8Array;
  type?: "0" | "2" | "5" | "x" | "g";
  link?: string;
  mtime?: number;
}

export function member(entry: Entry): Buffer {
  const data = entry.data ?? Buffer.alloc(0);
  const block = Buffer.alloc(512);
  const text = (value: string, offset: number, width: number) => {
    const encoded = Buffer.from(value);
    if (encoded.length > width) throw new Error(`fixture field too long: ${value}`);
    block.set(encoded, offset);
  };
  const octal = (value: number, offset: number, width: number) => text(`${value.toString(8).padStart(width - 1, "0")}\0`, offset, width);
  text(entry.name, 0, 100);
  octal(entry.type === "5" ? 0o755 : 0o640, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(data.length, 124, 12);
  octal(entry.mtime ?? epochSeconds, 136, 12);
  block.fill(32, 148, 156);
  text(entry.type ?? "0", 156, 1);
  text(entry.link ?? "", 157, 100);
  text("ustar\0", 257, 6);
  text("00", 263, 2);
  const sum = block.reduce((total, byte) => total + byte, 0);
  text(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return Buffer.concat([block, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}

export function archive(...entries: Uint8Array[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

export function pax(...fields: readonly [string, string][]): Buffer {
  return Buffer.concat(fields.map(([key, value]) => {
    const body = Buffer.from(` ${key}=${value}\n`);
    let length = body.length + 1;
    while (length !== body.length + String(length).length) length = body.length + String(length).length;
    return Buffer.concat([Buffer.from(String(length)), body]);
  }));
}

export function paxSample(): Buffer {
  return archive(
    member({ name: "global", type: "g", data: pax(["mtime", "1700123400"]) }),
    member({ name: "local", type: "x", data: pax(["path", "discarded"], ["comment", "雪"], ["path", longName], ["mtime", "1700123401.125"]) }),
    member({ name: "placeholder", data: pattern(1031) }),
    member({ name: "following", data: pattern(17, 7) }),
  );
}
