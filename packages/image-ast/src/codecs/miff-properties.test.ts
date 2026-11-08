import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeMiffFromStorage, encodeMiffImage } from "./miff.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
it.each([
    { comment: "side A", label: "badge" },
    { comment: "braces {nested} and \\slashes\\", label: 'quotes " and \nlines\t雪' },
    { comment: "", label: "" }
])("preserves MIFF properties in buffered and stored frames: %j", async properties => {
    const frame: RgbaImage = { width: 1, height: 1, format: "miff", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, data: Uint8Array.of(18, 52, 86, 255), properties };
    const other = { ...frame, properties: { comment: "second", label: "frame" } };
    const buffered = encodeMiffImage({ ...frame, miffPages: [frame, other] });
    const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async () => frame.data) };
    const chunks: Uint8Array[] = [];
    for await (const chunk of encodeMiffFromStorage({ ...frame, position: 0, storedMiffPages: { length: 2, async at(index) { return { ...(index === 0 ? frame : other), position: 0 }; } } }, storage, new AbortController().signal)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(buffered));
    expect(new TextDecoder().decode(buffered)).toContain("comment={");
    if (nativeMagick) {
        const result = spawnSync("magick", ["identify", "-format", "|%c|%l", "miff:-"], { input: buffered });
        expect(result.status).toBe(0);
        expect(result.stdout.toString()).toBe(`|${properties.comment}|${properties.label}|second|frame`);
    }
});
