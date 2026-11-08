import { describe, expect, it } from "vitest";
import { StackContext } from "./context.js";
import { createTrackedProxy, types } from "./types.js";
import { fsCodec } from "../modules/fs-codec.js";

describe("portable host primitives", () => {
  it("restores nested stack contexts and captured continuations", async () => {
    const context = new StackContext<string>();
    const resume = context.run("outer", () => {
      context.run("inner", () => expect(context.getStore()).toBe("inner"));
      expect(context.getStore()).toBe("outer");
      return StackContext.snapshot();
    });
    expect(context.getStore()).toBeUndefined();
    await Promise.resolve();
    resume(() => expect(context.getStore()).toBe("outer"));
    expect(context.getStore()).toBeUndefined();
    context.run("outer", () => context.exit(() => expect(context.getStore()).toBeUndefined()));
    expect(() => context.run("failed", () => { throw new Error("failed"); })).toThrow("failed");
    expect(context.getStore()).toBeUndefined();
    context.disable();
  });
  it("does not revive contexts disabled in nested scopes", () => {
    const context = new StackContext<number>();
    context.run(1, () => {
      context.run(2, () => context.disable());
      expect(context.getStore()).toBeUndefined();
    });
    context.run(1, () => {
      context.exit(() => context.disable());
      expect(context.getStore()).toBeUndefined();
    });
  });
  it("isolates captured continuations from contexts created after capture", () => {
    const first = new StackContext<string>();
    const resume = first.run("first", () => StackContext.snapshot());
    const later = new StackContext<string>();
    later.run("second", () => {
      resume(() => {
        expect(first.getStore()).toBe("first");
        expect(later.getStore()).toBeUndefined();
      });
      expect(later.getStore()).toBe("second");
      expect(first.getStore()).toBeUndefined();
    });
  });
  it("keeps concurrent explicit continuations isolated across host awaits", async () => {
    const context = new StackContext<string>();
    const first = context.run("first", () => StackContext.snapshot());
    const second = context.run("second", () => StackContext.snapshot());
    await Promise.all([first, second].map(async (resume, index) => {
      await Promise.resolve();
      resume(() => expect(context.getStore()).toBe(index === 0 ? "first" : "second"));
      expect(context.getStore()).toBeUndefined();
    }));
  });
  it("restores later contexts after throws without reviving disabled contexts", () => {
    const resume = StackContext.snapshot();
    const later = new StackContext<string>();
    later.run("later", () => {
      expect(() => resume(() => { throw null; })).toThrow();
      expect(later.getStore()).toBe("later");
      resume(() => later.disable());
      expect(later.getStore()).toBeUndefined();
    });
  });
  it("uses internal slots without invoking caller getters or coercion", () => {
    const fake = { get [Symbol.toStringTag]() { throw new Error("caller getter"); } };
    for (const check of [types.isDate, types.isRegExp, types.isArrayBuffer, types.isDataView,
      types.isMap, types.isBooleanObject, types.isNumberObject, types.isStringObject,
      types.isBigIntObject, types.isSymbolObject]) expect(check(fake)).toBe(false);
    expect(types.isProxy(createTrackedProxy({}, {}))).toBe(true);
    expect(types.isProxy({})).toBe(false);
    expect(types.isNumberObject(1)).toBe(false);
    expect(types.isNumberObject(Object(1))).toBe(true);
    expect(types.isDate(new Date())).toBe(true);
    expect(types.isRegExp(/a/u)).toBe(true);
    expect(types.isRegExp(RegExp.prototype)).toBe(false);
    expect(types.isArrayBuffer(new ArrayBuffer(0))).toBe(true);
    expect(types.isDataView(new DataView(new ArrayBuffer(0)))).toBe(true);
    expect(types.isMap(new Map())).toBe(true);
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    structuredClone(buffer, { transfer: [buffer] });
    expect(types.isArrayBuffer(buffer)).toBe(true);
    expect(types.isDataView(view)).toBe(true);
  });
  it.each(["utf8", "utf16le", "hex", "base64", "base64url", "latin1", "ascii"])("matches host encoding %s", encoding => {
    const text = "ab\u0000\u00e9\ud83d\ude00";
    const bytes = fsCodec.encode(text, encoding);
    expect([...bytes]).toEqual([...Buffer.from(text, encoding as BufferEncoding)]);
    expect(fsCodec.decode(bytes, encoding)).toBe(Buffer.from(bytes).toString(encoding as BufferEncoding));
  });
});
