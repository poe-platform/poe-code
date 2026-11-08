import { expect, it } from "vitest";
import { parsePdftkIntegerChunks } from "./info-integer-stream.js";

it.each(["", "  -000", "\uFEFF+000123tail", "+ 1", "0x12", "1e12", "-2.5", "Infinity", "9007199254740993", "9".repeat(309), "1" + "0".repeat(308)])("matches decimal parseInt for %s", async value => {
  async function* chunks() { for (const character of value) yield character; }
  expect(await parsePdftkIntegerChunks(chunks(), new AbortController().signal)).toBe(Number.parseInt(value, 10));
});

it("handles generated leading zeroes and overflows without collecting the input", async () => {
  async function* zeroes() { yield "-"; for (let i = 0; i < 512; i++) yield "0".repeat(4096); yield "37end"; }
  expect(await parsePdftkIntegerChunks(zeroes(), new AbortController().signal)).toBe(-37);
  let closed = false;
  async function* overflow() { try { for (let i = 0; i < 512; i++) yield "9".repeat(4096); } finally { closed = true; } }
  expect(await parsePdftkIntegerChunks(overflow(), new AbortController().signal)).toBe(Infinity);
  expect(closed).toBe(true);
});

it("observes cancellation while scanning leading zeroes", async () => {
  const controller = new AbortController(), reason = new Error("cancelled"); let closed = false;
  async function* chunks() { try { yield "0"; controller.abort(reason); yield "0"; } finally { closed = true; } }
  await expect(parsePdftkIntegerChunks(chunks(), controller.signal)).rejects.toBe(reason);
  expect(closed).toBe(true);
});
