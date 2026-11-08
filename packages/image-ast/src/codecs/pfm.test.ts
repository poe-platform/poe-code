import { expect, it } from "vitest";
import { decodeImage, readImageMetadata, encodeImage } from "./index.js";

it("retains unclamped floats before producing integer previews", () => {
    const header = new TextEncoder().encode("PF\r\n2 1\r\n-2.0\r\n"), bytes = new Uint8Array(header.length + 24);
    bytes.set(header); const view = new DataView(bytes.buffer);
    [-0.125, 0.125, 0.75, 0, 0.25005, 0.5].forEach((value, i) => view.setFloat32(header.length + i * 4, value, true));
    expect(readImageMetadata(bytes)).toMatchObject({ format: "pfm", width: 2, height: 1, depth: "float" });
    const image = decodeImage(bytes);
    expect(Array.from(image.dataFloat!)).toEqual([-0.25, 0.25, 1.5, 1, 0, Math.fround(0.5001), 1, 1]);
    expect(Array.from(image.data16!)).toEqual([0, 16384, 65535, 65535, 0, 32774, 65535, 65535]);
    expect(decodeImage(encodeImage(image, { format: "pfm" }).data).dataFloat).toEqual(image.dataFloat);
});

it("keeps distinct out-of-range RGB channels even when the integer preview is gray", () => {
    const header = new TextEncoder().encode("PF\n1 1\n1\n"), bytes = new Uint8Array(header.length + 12);
    bytes.set(header); const view = new DataView(bytes.buffer);
    [1, 2, 3].forEach((value, i) => view.setFloat32(header.length + i * 4, value));
    const image = decodeImage(bytes);
    expect(decodeImage(encodeImage(image, { format: "pfm" }).data).dataFloat).toEqual(image.dataFloat);
});
