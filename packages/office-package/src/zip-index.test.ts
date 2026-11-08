import {expect, it} from "vitest";
import {ZipDirectoryIndex} from "./zip-index.js";

it("keeps exact keys and numeric records in caller storage across shared prefixes and updates", async () => {
  const bytes = new Uint8Array(1024 * 1024);
  let end = 8;
  const index = new ZipDirectoryIndex({
    allocate(length) {const start = end; end += length; return start;},
    async read(position, length) {expect(length).toBeLessThanOrEqual(4096); return bytes.slice(position, position + length);},
    async write(position, chunk) {bytes.set(chunk, position);}
  });
  const keys = ["", "a", "ab", "abc", "abd", "é", "e", "😀", "a\0", "x".repeat(65535)];
  for (const [i, key] of keys.entries()) await index.set(key, i);
  for (const [i, key] of keys.entries()) expect(await index.get(key)).toBe(i);
  expect(await index.get("absent")).toBeUndefined();
  await index.set("ab", 999);
  expect(await index.get("ab")).toBe(999);
  expect(await index.get("abc")).toBe(3);
});

it("owns index headers before subsequent key reads reuse the storage response buffer", async () => {
  const bytes = new Uint8Array(16384);
  const response = new Uint8Array(4096);
  let end = 8;
  const index = new ZipDirectoryIndex({
    allocate(length) {const position = end; end += length; return position;},
    async read(position, length) {
      response.fill(0);
      response.set(bytes.subarray(position, position + length));
      return response.subarray(0, length);
    },
    async write(position, value) {bytes.set(value, position);}
  });
  await index.set("alpha", 123);
  await index.set("alphabet", 456);
  expect(await index.get("alpha")).toBe(123);
  expect(await index.get("alphabet")).toBe(456);
  await index.set("alpha", 789);
  expect(await index.get("alpha")).toBe(789);
  expect(await index.get("alphabet")).toBe(456);
});

it("rejects truncated key reads instead of turning indexed names into misses", async () => {
  const bytes = new Uint8Array(1024);
  let end = 8, truncate = false;
  const index = new ZipDirectoryIndex({
    allocate(length) {const position = end; end += length; return position;},
    async read(position, length) {return bytes.slice(position, position + (truncate && length !== 32 ? length - 2 : length));},
    async write(position, value) {bytes.set(value, position);}
  });
  await index.set("duplicate", 7);
  truncate = true;
  await expect(index.get("duplicate")).rejects.toThrow("Truncated ZIP index");
  await expect(index.set("duplicate", 8)).rejects.toThrow("Truncated ZIP index");
});

it("matches an independent map across deterministic mixed Unicode keys and repeated updates", async () => {
  const bytes = new Uint8Array(1024 * 1024);
  let end = 8, seed = 1773;
  const index = new ZipDirectoryIndex({
    allocate(length) {const position = end; end += length; return position;},
    async read(position, length) {return bytes.slice(position, position + length);},
    async write(position, value) {bytes.set(value, position);}
  });
  const expected = new Map<string, number>();
  for (let operation = 0; operation < 200; operation++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const key = ["", "prefix", "\0", "😀", "é"][seed % 5]! + String.fromCharCode((seed >>> 8) % 32);
    expected.set(key, operation);
    await index.set(key, operation);
  }
  for (const [key, value] of expected) expect(await index.get(key)).toBe(value);
  for (const key of expected.keys()) expect(await index.get(key + "absent")).toBeUndefined();
});

it("supports workbook-sized keys without rebuilding stored strings", async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024), response = new Uint8Array(4096);
  let end = 8;
  const index = new ZipDirectoryIndex({
    allocate(length) { const position = end; end += length; return position; },
    async read(position, length) { expect(length).toBeLessThanOrEqual(4096); response.set(bytes.subarray(position, position + length)); return response.subarray(0, length); },
    async write(position, chunk) { expect(chunk.length).toBeLessThanOrEqual(4096); bytes.set(chunk, position); }
  }, { maximumKeyLength: Infinity });
  const prefix = "🦀x".repeat(25000), keys = [prefix, prefix + "\0", prefix + "a", prefix.slice(0, -1), prefix + "😀"];
  for (const [i, key] of keys.entries()) await index.set(key, i);
  for (const [i, key] of keys.entries()) expect(await index.get(key)).toBe(i);
  await index.set(prefix, 123); expect(await index.get(prefix)).toBe(123);
  expect(await index.get(prefix + "z")).toBeUndefined();
});

it("cancels long index comparisons before pulling more storage", async () => {
  const bytes = new Uint8Array(200000), controller = new AbortController();
  let end = 8, reads = 0, cancel = false;
  const index = new ZipDirectoryIndex({
    allocate(length) { const position = end; end += length; return position; },
    async read(position, length) { reads++; if (cancel) controller.abort(new Error("stop")); return bytes.slice(position, position + length); },
    async write(position, chunk) { bytes.set(chunk, position); }
  }, { signal: controller.signal });
  await index.set("x".repeat(50000), 1); cancel = true;
  await expect(index.get("x".repeat(50000))).rejects.toThrow("stop");
  expect(reads).toBe(1);
});
