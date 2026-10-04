import { expect, it } from "vitest";
import { StoredType1Names } from "./stored-type1-names.js";
it("compares colliding names exactly and preserves cancellation after a backing response", async () => {
  const names = [".notdef", "costarring", "liquid", "costarring"],
    data = new Uint8Array(65536),
    controller = new AbortController(),
    reason = new Error("stop name lookup");
  let end = 0,
    abort = false;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      if (abort && n === 16) controller.abort(reason);
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      data.set(bytes, at);
    }
  };
  const index = new StoredType1Names(async (gid) => names[gid]!, storage, controller.signal);
  await index.build(names.length);
  expect(await index.find("costarring")).toBe(1);
  expect(await index.find("liquid")).toBe(2);
  expect(await index.find("costarring", 2)).toBe(3);
  abort = true;
  await expect(index.find("liquid")).rejects.toBe(reason);
});
