import { expect, it } from "vitest";
import { encodeId3, parseId3 } from "./id3.js";

for (const version of [3, 4] as const) {
  it(`writes ID3v2.${version} text, comments, custom tags and pictures`, () => {
    const tags = { title: "Écho 日本 😀".repeat(40), comment: "Draft 日本", custom: "Écho", date: "2026" };
    const pictures = [{ mime: "image/png", type: 3, description: "日本", data: new Uint8Array(200).fill(255) }];
    const bytes = encodeId3(tags, [], pictures, version);
    expect(bytes[3]).toBe(version);
    const size = new DataView(bytes.buffer).getUint32(14);
    expect(size).toBe(version === 3 ? 1 + 2 + tags.title.length * 2 :
      ((1 + new TextEncoder().encode(tags.title).length) >> 7) * 256 + ((1 + new TextEncoder().encode(tags.title).length) & 127));
    expect(bytes[20]).toBe(version === 3 ? 1 : 3);
    const parsed = parseId3(bytes);
    expect(parsed.tags).toEqual(tags);
    expect(parsed.pictures).toEqual(pictures);
    expect(parsed.nodes.map(node => node.type)).toContain(version === 3 ? "TYER" : "TDRC");
  });
}
