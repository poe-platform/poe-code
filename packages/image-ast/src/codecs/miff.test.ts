import { expect, it, vi } from "vitest";
import { encodeMiffFromStorage } from "./miff.js";
import type { StoredRgbaImage } from "./png-storage.js";

const image: StoredRgbaImage = { position: 0, width: 2051, height: 1, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true };

it("pulls bounded MIFF pixels and owns chunks across borrowed storage reads", async () => {
    const buffer = new Uint8Array(4096);
    const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (_position: number, length: number) => { buffer.fill(storage.read.mock.calls.length); return buffer.subarray(0, length); }) };
    const stream = encodeMiffFromStorage(image, storage, new AbortController().signal);
    await stream.next();
    expect(storage.read).not.toHaveBeenCalled();
    const first = (await stream.next()).value!;
    expect(first.length).toBe(4096);
    await stream.next();
    expect(first.every(byte => byte === 1)).toBe(true);
    expect((await stream.next()).value?.length).toBe(12);
    expect((await stream.next()).done).toBe(true);
    expect(storage.read.mock.calls.map(([position, length]) => [position, length])).toEqual([[0, 4096], [4096, 4096], [8192, 12]]);
});

it("stops before reading pixels when MIFF output is cancelled", async () => {
    const controller = new AbortController(), reason = new Error("cancelled");
    const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn() };
    const stream = encodeMiffFromStorage(image, storage, controller.signal);
    await stream.next();
    controller.abort(reason);
    await expect(stream.next()).rejects.toBe(reason);
    expect(storage.read).not.toHaveBeenCalled();
});

it("rejects truncated MIFF pixels", async () => {
    const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async () => new Uint8Array(1)) };
    const stream = encodeMiffFromStorage(image, storage, new AbortController().signal);
    await stream.next();
    await expect(stream.next()).rejects.toThrow("Truncated MIFF backing storage");
});
