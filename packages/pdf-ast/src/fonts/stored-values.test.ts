import { expect, it } from "vitest";
import { StoredFontValues } from "./stored-values.js";

it("preserves sparse validation operands with one cached page", async () => {
  const bytes = new Uint8Array(256 * 1024);
  let end = 0;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      expect(n).toBeLessThanOrEqual(4096);
      return bytes.slice(at, at + n);
    },
    async write(at: number, data: Uint8Array) {
      expect(data.length).toBeLessThanOrEqual(4096);
      bytes.set(data, at);
    }
  };
  const values = new StoredFontValues(storage);
  for (let i = 0; i < 4096; i += 2) await values.set(i, i);
  for (let i = 4095; i >= 0; i--) expect(await values.get(i)).toBe(i % 2 ? undefined : i);
  for (const [index, value] of [
    [0, NaN],
    [500, -0],
    [1000, Infinity],
    [4000, -Infinity]
  ])
    await values.set(index!, value);
  expect(Object.is(await values.get(500), -0)).toBe(true);
  expect(await values.get(0)).toBeNaN();
  expect(await values.get(1000)).toBe(Infinity);
  expect(await values.get(4000)).toBe(-Infinity);
  const peak = end;
  values.clear();
  await values.set(4095, 1);
  expect(await values.get(4000)).toBeUndefined();
  expect(await values.slice(4093, 4096)).toEqual([undefined, undefined, 1]);
  expect(end).toBe(peak);
});
