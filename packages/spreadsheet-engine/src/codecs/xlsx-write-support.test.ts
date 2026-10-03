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
