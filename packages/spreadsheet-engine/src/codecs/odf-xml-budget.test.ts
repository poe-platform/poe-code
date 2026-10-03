import { expect, it, vi } from "vitest";
import { defaultSsconvertLimits } from "../engine.js";
import { createOdfXml } from "./odf-write-support.js";

it.each(["ascii", "é", "世界", "🦀", "\ud800"])("counts exact UTF-8 bytes without allocating for %j", text => {
  const expected = `<text:p>${text}</text:p>`, bytes = new TextEncoder().encode(expected).length;
  const encode = vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(() => { throw new Error("whole XML encoding"); });
  const context = { signal: new AbortController().signal, limits: { ...defaultSsconvertLimits, outputBytes: bytes },
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
  try {
    expect(createOdfXml(context, false).element("text:p", {}, text)).toBe(expected);
    expect(() => createOdfXml({ ...context, limits: { ...context.limits, outputBytes: bytes - 1 } }, false).element("text:p", {}, text)).toThrow("output bytes limit");
  } finally { encode.mockRestore(); }
});
