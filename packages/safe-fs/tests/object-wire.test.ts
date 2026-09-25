import { describe, expect, it } from "vitest";
import { toFsError } from "../src/contracts/errors.js";
import { BytePath, decodeBytePath, encodeBytePath, decodeFileOffset, encodeFileOffset, fileOffset, decodeObjectMetadata, encodeObjectMetadata } from "../src/contracts/object.js";

describe("lossless object wire values", () => {
  it("serializes owned path bytes even when the public accessor is replaced", () => {
    const path = new BytePath(Uint8Array.of(47, 255, 128));
    path.bytes = () => new TextEncoder().encode("/\ufffd\ufffd");
    expect(decodeBytePath(JSON.parse(JSON.stringify(encodeBytePath(path)))).bytes())
      .toEqual(Uint8Array.of(47, 255, 128));
  });
  it("decodes indexed wire octets without allowing an iterator to substitute a pathname", () => {
    const wire = [47, 255];
    wire[Symbol.iterator] = function* (): ArrayIterator<number> { yield 47; yield 97; };
    expect(decodeBytePath(wire).bytes()).toEqual(Uint8Array.of(47, 255));
  });
  it("rejects inherited octets instead of filling missing wire entries", () => {
    const wire = new Array<number>(2);
    wire[0] = 47;
    Object.setPrototypeOf(wire, Object.assign(Object.create(Array.prototype), { 1: 255 }));
    expect(() => decodeBytePath(wire)).toThrow();
  });
  it("retains the admitted path length when an octet accessor grows its carrier", () => {
    const wire = [47, 255];
    Object.defineProperty(wire, 1, { get: () => { wire.push(97); return 255; } });
    expect(decodeBytePath(wire).bytes()).toEqual(Uint8Array.of(47, 255));
  });
  it("converts only the octets it validated, even with accessor-backed input", () => {
    let reads = 0;
    const wire = [47, 255];
    Object.defineProperty(wire, 1, { get: () => ++reads === 1 ? 255 : 257 });
    expect(decodeBytePath(wire).bytes()).toEqual(Uint8Array.of(47, 255));
    expect(reads).toBe(1);
  });
  it("rejects missing octets before typed-array conversion", () => {
    const missing = [47, 128, 255];
    delete missing[1];
    expect(() => decodeBytePath(new Array(2))).toThrow();
    expect(() => decodeBytePath(missing)).toThrow();
  });
  it("preserves the native invalid-byte-name refusal", () => {
    expect(toFsError({ code: "EILSEQ" }).code).toBe("EILSEQ");
  });
  it("owns invalid UTF-8 bytes across JSON and caller mutation", () => {
    const input = Uint8Array.of(47, 255, 128);
    const path = new BytePath(input);
    input.fill(0);
    const wire = JSON.parse(JSON.stringify(encodeBytePath(path)));
    expect(decodeBytePath(wire).bytes()).toEqual(Uint8Array.of(47, 255, 128));
    path.bytes().fill(0);
    expect(path.bytes()).toEqual(Uint8Array.of(47, 255, 128));
  });
  it("owns Node Buffer inputs as well as Uint8Arrays", () => {
    const bytes = Buffer.from([47, 255]);
    const path = new BytePath(bytes);
    bytes.fill(0);
    expect(path.bytes()).toEqual(Uint8Array.of(47, 255));
  });
  it("rejects runtime numeric timestamps before any decimal conversion", () => {
    expect(() => encodeObjectMetadata({ mtimeNs: 9007199254740992 as unknown as bigint })).toThrow();
  });
  it("transports metadata without rounding nanoseconds or pre-epoch times", () => {
    const value = { mode: 0o640, uid: 1000, gid: 1000, atimeNs: -1n, mtimeNs: 1234567890000000001n };
    expect(decodeObjectMetadata(JSON.parse(JSON.stringify(encodeObjectMetadata(value))))).toEqual(value);
  });
  it.each([{ uid: -1 }, { mode: 0.5 }, { mtimeNs: 9007199254740992 }, { mtimeNs: "-0" }, { xattr: "unsupported" }])("rejects invalid wire metadata %j", value => {
    expect(() => decodeObjectMetadata(value)).toThrow();
  });
  it.each([[], [0], [256], [-1], [1.5], ["47"], "abc", null].map(value => [value]))("rejects invalid paths %j", value => {
    expect(() => decodeBytePath(value)).toThrow();
  });
  it("round trips exact sparse and maximum signed native offsets", () => {
    for (const offset of [0n, 9007199254740993n, 9223372036854775807n]) {
      expect(decodeFileOffset(JSON.parse(JSON.stringify(encodeFileOffset(offset))))).toBe(offset);
    }
    expect(fileOffset(42)).toBe(42n);
  });
  it.each([42, 9007199254740992])("rejects runtime number offsets at the exact wire boundary %s", value => {
    expect(() => encodeFileOffset(value as unknown as bigint)).toThrow();
  });
  it.each([9007199254740992, -1, 0.5, NaN, Infinity])("refuses inexact legacy offsets %s", value => {
    expect(() => fileOffset(value)).toThrow();
  });
  it.each([1, "01", "+1", "-1", " 1", "1e3", "", "9223372036854775808"]) ("rejects noncanonical wire offset %j", value => {
    expect(() => decodeFileOffset(value)).toThrow();
  });
});
