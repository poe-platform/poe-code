import { expect, it, vi } from "vitest";
import { BackingArena } from "./backing-arena.js";
import type { ImageByteStorage } from "./png-storage.js";
function fixture() {
  const bytes = new Uint8Array(1024 * 1024),
    borrowed = new Uint8Array(4096);
  let next = 13;
  const storage: ImageByteStorage = {
    allocate: vi.fn((length) => {
      const at = next;
      next += length + 7;
      return at;
    }),
    async read(at, length) {
      borrowed.fill(17);
      borrowed.set(bytes.subarray(at, at + length));
      return borrowed.subarray(0, length);
    },
    async write(at, data) {
      bytes.set(data, at);
    }
  };
  return { storage, arena: new BackingArena(storage) };
}
it("reuses caller backing across arbitrarily many decoded chunks", async () => {
  const { storage, arena } = fixture();
  expect(arena.allocate(10000)).toBe(0);
  const count = vi.mocked(storage.allocate).mock.calls.length;
  for (let i = 0; i < 100; i++) {
    arena.reset();
    expect(arena.allocate(5000)).toBe(0);
    await arena.write(4094, Uint8Array.of(i, 1, 2, 3, 4, 5, 6, 7));
    expect(await arena.read(4094, 8)).toEqual(Uint8Array.of(i, 1, 2, 3, 4, 5, 6, 7));
  }
  expect(storage.allocate).toHaveBeenCalledTimes(count);
});
it("grows only to the largest requested chunk and copies borrowed boundary reads", async () => {
  const { storage, arena } = fixture();
  arena.allocate(6000);
  await arena.write(4094, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
  const first = await arena.read(4094, 8);
  await arena.read(0, 8);
  expect(first).toEqual(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
  arena.reset();
  arena.allocate(50000);
  const count = vi.mocked(storage.allocate).mock.calls.length;
  arena.reset();
  arena.allocate(49000);
  expect(storage.allocate).toHaveBeenCalledTimes(count);
});
it("keeps address metadata bounded even for the maximum safe logical allocation", () => {
  let end = 0,
    calls = 0;
  const arena = new BackingArena({
    allocate(length) {
      calls++;
      const start = end;
      end += length;
      return start;
    },
    async read() {
      throw new Error("not read");
    },
    async write() {
      throw new Error("not written");
    }
  });
  expect(arena.allocate(Number.MAX_SAFE_INTEGER)).toBe(0);
  expect(calls).toBeLessThanOrEqual(53);
  expect(end).toBe(Number.MAX_SAFE_INTEGER);
  expect(() => arena.allocate(1)).toThrow(RangeError);
});
it("rejects ranges outside the current chunk after reset", async () => {
  const { arena } = fixture();
  arena.allocate(10000);
  arena.reset();
  arena.allocate(16);
  await expect(arena.read(16, 1)).rejects.toThrow(RangeError);
  await expect(arena.write(16, Uint8Array.of(1))).rejects.toThrow(RangeError);
});
it("preserves cancellation and short-read diagnostics", async () => {
  const { storage, arena } = fixture(),
    controller = new AbortController(),
    reason = new Error("cancel");
  arena.allocate(10000);
  storage.read = async () => {
    controller.abort(reason);
    return new Uint8Array(4);
  };
  await expect(arena.read(0, 4, { signal: controller.signal })).rejects.toBe(reason);
  storage.read = async () => new Uint8Array();
  await expect(arena.read(0, 4)).rejects.toThrow("Truncated image backing storage");
});
