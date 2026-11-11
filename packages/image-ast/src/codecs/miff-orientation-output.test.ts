import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodeImage } from "./index.js";
import { encodeMiffFromStorage, encodeMiffImage } from "./miff.js";

it.each([
    { orientation: undefined, name: undefined },
    { orientation: 0, name: undefined },
    { orientation: 1, name: "TopLeft" },
    { orientation: 2, name: "TopRight" },
    { orientation: 3, name: "BottomRight" },
    { orientation: 4, name: "BottomLeft" },
    { orientation: 5, name: "LeftTop" },
    { orientation: 6, name: "RightTop" },
    { orientation: 7, name: "RightBottom" },
    { orientation: 8, name: "LeftBottom" }
])("preserves each frame's orientation in buffered and stored MIFF: $orientation", async ({ orientation, name }) => {
    const frame: RgbaImage = { width: 2, height: 1, format: "miff", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
        data: Uint8Array.of(18, 52, 86, 255, 120, 154, 188, 255), orientation };
    const other = { ...frame, orientation: 1 };
    const original = structuredClone(frame);
    const buffered = encodeMiffImage({ ...frame, miffPages: [frame, other] });
    const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async () => frame.data) };
    const chunks: Uint8Array[] = [];
    for await (const chunk of encodeMiffFromStorage({ ...frame, position: 0, storedMiffPages: { length: 2, async at(index) { return { ...(index === 0 ? frame : other), position: 0 }; } } }, storage, new AbortController().signal)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(buffered));
    expect(frame).toEqual(original);
    const header = new TextDecoder().decode(buffered.subarray(0, buffered.indexOf(26)));
    if (name) expect(header).toContain(`orientation=${name}\n`);
    else expect(header).not.toContain("orientation=");
    for (const page of [0, 1]) {
        const decoded = decodeImage(buffered, { page });
        expect(decoded).toMatchObject({ width: 2, height: 1, data: frame.data });
        expect(decoded.orientation).toBe(page === 0 ? orientation || undefined : 1);
    }
});
