import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { createCompressedGuestSource } from "../src/browser-guest-source.js";

const source = 'export default () => "browser: \u2603";';
const bytes = Buffer.from(source);
const compressed = gzipSync(bytes).toString("base64");

test("guest source restores exact UTF-8 bytes, supports concurrent loads, and honors cancellation", async () => {
  const load = createCompressedGuestSource(compressed, bytes.length);
  const signal = new AbortController().signal;
  expect(await Promise.all([load(signal), load(signal)])).toEqual([source, source]);
  expect(await load(signal)).toBe(source);
  const aborted = AbortSignal.abort(new Error("cancelled"));
  await expect(load(aborted)).rejects.toThrow("cancelled");
  const fresh = createCompressedGuestSource(compressed, bytes.length);
  await expect(fresh(aborted)).rejects.toThrow("cancelled");
  expect(await fresh(signal)).toBe(source);
});

test("guest source rejects corrupt and incorrectly sized payloads", async () => {
  const signal = new AbortController().signal;
  await expect(createCompressedGuestSource(compressed, bytes.length - 1)(signal)).rejects.toThrow("exceeds");
  await expect(createCompressedGuestSource(compressed, bytes.length + 1)(signal)).rejects.toThrow("mismatch");
  const corrupt = gzipSync(bytes); corrupt[corrupt.length - 5] ^= 1;
  await expect(createCompressedGuestSource(corrupt.toString("base64"), bytes.length)(signal)).rejects.toThrow();
});
