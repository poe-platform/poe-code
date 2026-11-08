import { parseEmbeddedCffFont } from "./cff.js";
import { expect, it } from "vitest";
import { CFFParser, Stream } from "../vendor/pdfjs-fonts.mjs";

it("admits compact CFF charset expansion before storing its entries", () => {
  const failure = new Error("charset owner rejected expansion");
  const parser = new CFFParser(new Stream(new Uint8Array([0, 0, 0, 2, 0, 0, 255, 255])), {}, false,
    bytes => { if (bytes > 100000) throw failure; });
  expect(() => parser.parseCharsets(3, 2, null, true)).toThrow(failure);
});

it("admits compact CFF FDSelect ranges before expanding them", () => {
  const failure = new Error("FDSelect owner rejected expansion");
  const parser = new CFFParser(new Stream(new Uint8Array([3, 0, 1, 0, 0, 0, 255, 255])), {}, false,
    bytes => { if (bytes > 100000) throw failure; });
  expect(() => parser.parseFDSelect(0, 65535)).toThrow(failure);
});

it("rejects truncated CFF charset ranges instead of reading forever", () => {
  const parser = new CFFParser(new Stream(new Uint8Array([0, 0, 0, 1, 0])), {}, false);
  const owner = parser as unknown as { bytes: Uint8Array };
  owner.bytes = new Proxy(owner.bytes, { get(target, key) {
    if (typeof key === "string" && Number(key) >= target.length) throw new Error("read past truncated charset");
    return Reflect.get(target, key, target);
  } });
  expect(() => parser.parseCharsets(3, 2, null, true)).toThrow("Truncated CFF charset range");
});


it("admits the owned CFF copy before decoding the font program", () => {
  const failure = new Error("font copy owner exhausted");
  expect(() => parseEmbeddedCffFont(new Uint8Array([0]), undefined, new Map(), {
    onAllocation() { throw failure; },
  })).toThrow(failure);
});
