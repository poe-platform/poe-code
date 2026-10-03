import { expect, it, vi } from "vitest";
import { defaultSsconvertLimits } from "../engine.js";
import type { CapabilityContext } from "../contracts.js";
import { createXlsxXml } from "./xlsx-write-support.js";

const context = (outputBytes: number): CapabilityContext => ({ signal: new AbortController().signal,
  limits: { ...defaultSsconvertLimits, outputBytes }, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });

it("checks XML UTF-8 output limits without allocating encoded copies", () => {
  const attributes = { title: "é🦀&" }, content = "é🦀".repeat(10000);
  const expected = createXlsxXml(context(Infinity)).element("x", attributes, content);
  const length = new TextEncoder().encode(expected).length;
  const encoding = vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(() => { throw new Error("encoded XML copy"); });
  try {
    expect(createXlsxXml(context(length)).element("x", attributes, content)).toBe(expected);
    expect(() => createXlsxXml(context(length - 1)).element("x", attributes, content)).toThrow("output bytes");
    expect(encoding).not.toHaveBeenCalled();
  } finally { encoding.mockRestore(); }
});


it("streams XML containers with exact empty spelling and UTF-8 limits", async () => {
  const content = "é🦀".repeat(10000), attributes = { title: "é&" };
  const expected = createXlsxXml(context(Infinity)).element("row", attributes, content);
  const length = new TextEncoder().encode(expected).length;
  async function* fragments() { yield ""; yield content.slice(0, 3); yield content.slice(3); }
  const collect = async (source: AsyncIterable<Uint8Array>) => {
    const parts = []; for await (const bytes of source) parts.push(bytes);
    return Buffer.concat(parts).toString("utf8");
  };
  expect(await collect(createXlsxXml(context(length)).stream("row", attributes, fragments()))).toBe(expected);
  await expect(collect(createXlsxXml(context(length - 1)).stream("row", attributes, fragments()))).rejects.toThrow("output bytes");
  async function* empty() { yield ""; yield new Uint8Array(); }
  expect(await collect(createXlsxXml(context(100)).stream("row", {}, empty()))).toBe("<row/>");
});

it("closes a streamed XML source on consumer return and checks cancellation", async () => {
  const controller = new AbortController(); let closed = false, pulled = 0;
  const xml = createXlsxXml({ ...context(Infinity), signal: controller.signal });
  async function* content() { try { while (true) { pulled++; yield "x".repeat(16384); } } finally { closed = true; } }
  const source = xml.stream("sheetData", {}, content());
  expect((await source.next()).value?.length).toBeLessThanOrEqual(16384);
  expect(pulled).toBe(1);
  await source.return(undefined); expect(closed).toBe(true);
  controller.abort(new Error("stop"));
  await expect(xml.stream("sheetData", {}, content()).next()).rejects.toThrow("stop");
  expect(pulled).toBe(1);
});
