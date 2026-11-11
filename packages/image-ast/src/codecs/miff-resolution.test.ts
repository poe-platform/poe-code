import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeMiffFromStorage, encodeMiffImage } from "./miff.js";

it.each([
    { resolution: { x: 12.3456789, y: 98.7654321, unit: "inch" as const }, density: 12.3456789, expected: "resolution=12.3457x98.7654\nunits=PixelsPerInch\n" },
    { resolution: { x: 1234.56789, y: 9876.54321, unit: "meter" as const }, density: 31.358024406, expected: "resolution=12.3457x98.7654\nunits=PixelsPerCentimeter\n" },
    { resolution: undefined, density: 12.3456789, expected: "resolution=12.3457x12.3457\nunits=Undefined\n" },
    { resolution: { x: 144, y: 72, unit: "inch" as const }, density: 144, expected: "resolution=144x72\nunits=PixelsPerInch\n" },
    { resolution: { x: 56.5, y: 28.25, unit: "cm" as const }, density: 143.51, expected: "resolution=56.5x28.25\nunits=PixelsPerCentimeter\n" },
    { resolution: { x: 5650, y: 2825, unit: "meter" as const }, density: 143.51, expected: "resolution=56.5x28.25\nunits=PixelsPerCentimeter\n" },
    { resolution: { x: 144, y: 72, unit: "unknown" as const }, density: 144, expected: "resolution=144x72\nunits=Undefined\n" },
    { resolution: undefined, density: 96, expected: "resolution=96x96\nunits=Undefined\n" }
])("writes each frame's resolution in both encoders: $expected", async ({ resolution, density, expected }) => {
    const frame: RgbaImage = { width: 1, height: 1, format: "miff", space: "srgb", channels: 3, depth: "uchar", density, resolution, hasAlpha: false, data: Uint8Array.of(18, 52, 86, 255) };
    const other = { ...frame, resolution: { x: 300, y: 150, unit: "inch" as const } };
    const original = structuredClone(frame);
    const buffered = encodeMiffImage({ ...frame, miffPages: [frame, other] });
    const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async () => frame.data) };
    const chunks: Uint8Array[] = [];
    for await (const chunk of encodeMiffFromStorage({ ...frame, position: 0, storedMiffPages: { length: 2, async at(index) { return { ...(index === 0 ? frame : other), position: 0 }; } } }, storage, new AbortController().signal)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(buffered));
    const headers = new TextDecoder().decode(buffered);
    expect(frame).toEqual(original);
    expect(headers).toContain(expected);
    expect(headers).toContain("resolution=300x150\nunits=PixelsPerInch\n");
});
