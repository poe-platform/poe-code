import { expect, it } from "vitest";
import { StoredFontBytes } from "./stored-font-bytes.js";

it("keeps converted byte ranges in caller pages and reuses rejected output", async () => {
  const data = new Uint8Array(131072);
  let end = 0;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      expect(n).toBeLessThanOrEqual(4096);
      return data.subarray(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      data.set(bytes, at);
    }
  };
  const output = new StoredFontBytes(storage),
    expected = new Uint8Array(20000);
  for (let i = 0; i < expected.length; i++) expected[i] = i % 251;
  for (let at = 0; at < expected.length; at += 1024)
    await output.push(...expected.subarray(at, at + 1024));
  const range = output.range(3, 18000),
    view = new DataView(expected.buffer, 3, 17997);
  for (const at of [0, 4091, 4092, 8190, 16000]) {
    expect(await range.byte(at)).toBe(expected[3 + at]);
    expect(await range.int(at, 4)).toBe(view.getInt32(at));
  }
  const allocated = end;
  output.truncate(4094);
  await output.push(255, 254, 253, 252);
  expect(output.length).toBe(4098);
  expect(await output.range().int(4094, 4)).toBe(-66052);
  expect(end).toBe(allocated);
  expect(await output.range().byte(4098)).toBeUndefined();
  await expect(output.range().int(4096, 4)).rejects.toBeInstanceOf(RangeError);
});
