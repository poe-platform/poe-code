import { expect, it } from "vitest";
import { encodeId3, parseId3 } from "./id3.js";

for (const version of [3, 4] as const) {
  it(`reads ID3v2.${version} chapter times and nested Unicode titles without leaking chapter tags`, () => {
    const nested = encodeId3({ title: "Verse é 🎵" }, [], [], version).subarray(10);
    const data = new Uint8Array(19 + nested.length);
    data.set([99, 49, 0]);
    const view = new DataView(data.buffer);
    view.setUint32(3, 250); view.setUint32(7, 750);
    view.setUint32(11, 0xffffffff); view.setUint32(15, 0xffffffff);
    data.set(nested, 19);
    const tag = encodeId3({ title: "Recording" }, [
      { type: "CHAP", offset: 0, size: data.length, data }
    ], [], version);
    expect(parseId3(tag).chapters).toEqual([{ start: 250, end: 750, tags: { title: "Verse é 🎵" } }]);
    expect(parseId3(tag).tags).toEqual({ title: "Recording" });
  });
}

for (const data of [new Uint8Array([99]), new Uint8Array([99, 0, 1, 2])]) {
  it(`rejects a truncated chapter with ${data.length} bytes`, () => {
    expect(() => parseId3(encodeId3({}, [{ type: "CHAP", offset: 0, size: data.length, data }]))).toThrow();
  });
}
