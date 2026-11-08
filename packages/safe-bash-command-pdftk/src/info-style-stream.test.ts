import { expect, it } from "vitest";
import { parsePdftkStyleChunks } from "./info-style-stream.js";

it.each(["DecimalArabicNumerals", "UppercaseRomanNumerals", "LowercaseRomanNumerals", "UppercaseLetters", "LowercaseLetters", "", "unknown", "UppercaseLettersX"])("matches the complete style %s", async value => {
  async function* chunks() { for (const character of value) yield character; }
  expect(await parsePdftkStyleChunks(chunks(), new AbortController().signal)).toBe(value);
});

it("consumes oversized generated fields with bounded retained text", async () => {
  let consumed = 0;
  async function* chunks() { yield "UppercaseLetters"; for (let i = 0; i < 512; i++) { consumed++; yield "x".repeat(4096); } }
  expect(await parsePdftkStyleChunks(chunks(), new AbortController().signal)).toBe("");
  expect(consumed).toBe(512);
});

it("preserves cancellation and closes input after exceeding the bound", async () => {
  const controller = new AbortController(), reason = new Error("cancelled"); let closed = false;
  async function* chunks() { try { yield "x".repeat(4096); controller.abort(reason); yield "x"; } finally { closed = true; } }
  await expect(parsePdftkStyleChunks(chunks(), controller.signal)).rejects.toBe(reason);
  expect(closed).toBe(true);
});
