import { describe, expect, it } from "vitest";

import { redact } from "./redact.js";

describe("redact", () => {
  it("truncates strings whose UTF-8 byte length exceeds 65536", () => {
    expect(redact("a".repeat(65_537))).toBe("[truncated:65537]");
  });

  it("redacts buffers with a null byte in the first 1024 bytes", () => {
    const value = Buffer.from([1, 2, 0, 3]);

    expect(redact(value)).toBe("[binary:4]");
  });

  it("redacts Uint8Arrays with a null byte in the first 1024 bytes", () => {
    const value = new Uint8Array([1, 2, 0, 3]);

    expect(redact(value)).toBe("[binary:4]");
  });

  it("does not redact binary values with a null byte after the first 1024 bytes", () => {
    const value = Buffer.alloc(1_026, 1);
    value[1_025] = 0;

    expect(redact(value)).toBe(value);
  });

  it("truncates the whole value when its JSON-serialized size exceeds 262144 bytes", () => {
    const value = { payload: "a".repeat(262_145) };
    const originalBytes = Buffer.byteLength(JSON.stringify(value), "utf8");

    expect(redact(value)).toBe(`[truncated:${originalBytes}]`);
  });

  it("recurses into nested structures and preserves unaffected leaves", () => {
    const input = {
      id: 123,
      name: "run",
      events: [
        { output: "ok", data: Buffer.from([1, 0, 2]) },
        { output: "é".repeat(32_769), data: new Uint8Array([1, 2, 3]) },
      ],
      enabled: true,
      missing: null,
    };

    expect(redact(input)).toEqual({
      id: 123,
      name: "run",
      events: [
        { output: "ok", data: "[binary:3]" },
        { output: "[truncated:65538]", data: input.events[1].data },
      ],
      enabled: true,
      missing: null,
    });
    expect(redact(input)).not.toBe(input);
  });

  it("replaces cyclic references without throwing", () => {
    const value: Record<string, unknown> = { output: "ok" };
    value.self = value;

    expect(redact(value)).toEqual({
      output: "ok",
      self: "[circular]",
    });
  });
});
