import { expect, it } from "vitest";
import type { PdfPixelStorage } from "../ast.js";
import { StoredFontOperands } from "./stored-operands.js";

function backing() {
  const bytes = new Uint8Array(256 * 1024);
  let end = 0,
    calls = 0;
  const storage: PdfPixelStorage = {
    allocate(length) {
      const position = end;
      end += length;
      return position;
    },
    async read(position, length) {
      calls++;
      expect(length).toBeLessThanOrEqual(4096);
      return bytes.slice(position, position + length);
    },
    async write(position, data) {
      calls++;
      expect(data.length).toBeLessThanOrEqual(4096);
      bytes.set(data, position);
    }
  };
  return {
    storage,
    get calls() {
      return calls;
    }
  };
}

it("preserves mixed front/back operations across caller-backed pages", async () => {
  const backingStore = backing(),
    stack = new StoredFontOperands(backingStore.storage);
  const expected: number[] = [];
  for (let i = 0; i < 4096; i++) {
    await stack.push(i);
    expected.push(i);
  }
  for (let i = 0; i < 1900; i++) {
    expect(await stack.shift()).toBe(expected.shift());
    expect(await stack.pop()).toBe(expected.pop());
  }
  for (let i = 0; i < 1024; i++) {
    await stack.push(-i);
    expected.push(-i);
  }
  while (expected.length) expect(await stack.shift()).toBe(expected.shift());
  expect(stack.length).toBe(0);
  expect(await stack.pop()).toBeUndefined();
  expect(await stack.shift()).toBeUndefined();
  expect(backingStore.calls).toBeLessThan(100);
});

it("reuses cleared scratch and preserves floating-point values", async () => {
  const { storage } = backing(),
    stack = new StoredFontOperands(storage);
  for (let i = 0; i < 1024; i++) await stack.push(i);
  stack.length = 0;
  const values = [NaN, -0, Infinity, -Infinity, 0.25];
  for (const value of values) await stack.push(value);
  for (const value of values) expect(Object.is(await stack.shift(), value)).toBe(true);
});

it("propagates backend failures and cancellation", async () => {
  const { storage } = backing(),
    failure = new Error("offline"),
    controller = new AbortController();
  const stack = new StoredFontOperands({
    ...storage,
    async write() {
      throw failure;
    }
  });
  await expect(
    (async () => {
      for (let i = 0; i < 1024; i++) await stack.push(i);
    })()
  ).rejects.toBe(failure);
  const stopped = new StoredFontOperands(storage, controller.signal);
  controller.abort(failure);
  await expect(stopped.push(1)).rejects.toBe(failure);
});

it("preserves a deque across repeated partial-page turns", async () => {
  const { storage } = backing(),
    stack = new StoredFontOperands(storage),
    values: number[] = [];
  let random = 7;
  for (let step = 0; step < 10000; step++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const action = random % 10;
    if (action < 6) {
      await stack.push(step);
      values.push(step);
    } else if (action < 8) expect(await stack.shift()).toBe(values.shift());
    else expect(await stack.pop()).toBe(values.pop());
    expect(stack.length).toBe(values.length);
  }
  while (values.length) expect(await stack.pop()).toBe(values.pop());
});

it("preserves backend read errors while traversing interior pages", async () => {
  const { storage } = backing(),
    failure = new Error("read failed");
  const stack = new StoredFontOperands({
    ...storage,
    async read() {
      throw failure;
    }
  });
  for (let i = 0; i < 1600; i++) await stack.push(i);
  await expect(
    (async () => {
      while (stack.length) await stack.pop();
    })()
  ).rejects.toBe(failure);
});
