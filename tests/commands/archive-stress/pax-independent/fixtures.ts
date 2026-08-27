import assert from "node:assert/strict";

export const rawSeconds = 1700123456;
export const fileData = Buffer.from([0, 255, 1, 128, 10, 61, 99]);
export const opaque = Buffer.concat([Buffer.from([0, 255, 192, 175]), Buffer.from("\n20 path=../outside/keep\nsize=999999\ntype=2\n")]);

export function record(key: string | Uint8Array, value: string | Uint8Array): Buffer {
  const keyBytes = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  const valueBytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  const body = Buffer.concat([Buffer.from(" "), keyBytes, Buffer.from("="), valueBytes, Buffer.from("\n")]);
  let length = body.length + 1;
  while (length !== body.length + String(length).length) length = body.length + String(length).length;
  return Buffer.concat([Buffer.from(String(length)), body]);
}

export function checksum(header: Buffer): void {
  header.fill(32, 148, 156);
  const sum = header.subarray(0, 512).reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
}

export function member(name: string, data: Uint8Array = Buffer.alloc(0), type = "0", link = "", declaredSize = data.length): Buffer {
  const header = Buffer.alloc(512);
  const field = (value: string, start: number, width: number) => {
    const bytes = Buffer.from(value);
    assert.ok(bytes.length <= width, `independent fixture field overflow: ${value}`);
    header.set(bytes, start);
  };
  const number = (value: number, start: number, width: number) => field(`${value.toString(8).padStart(width - 1, "0")}\0`, start, width);
  field(name, 0, 100);
  number(0o640, 100, 8);
  number(0, 108, 8);
  number(0, 116, 8);
  number(declaredSize, 124, 12);
  number(rawSeconds, 136, 12);
  field(type, 156, 1);
  field(link, 157, 100);
  field("ustar\0", 257, 6);
  field("00", 263, 2);
  checksum(header);
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}

export function archive(...members: Uint8Array[]): Buffer {
  return Buffer.concat([...members, Buffer.alloc(1024)]);
}

export function extended(records: Uint8Array, following = member("keep", fileData)): Buffer {
  return archive(member("metadata", records, "x"), following);
}
