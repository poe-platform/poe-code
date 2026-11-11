import { defaultRuntime } from "@poe-code/compression";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";

/** PSD v1: one editable RGB layer and its merged image, with raw channel planes. */
function* psdChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "density" | "resolution">, depth: number): Generator<number | Uint8Array, void, Uint8Array | Uint16Array> {
    const { width, height, hasAlpha } = image, channels = hasAlpha ? 4 : 3;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 30000 || height > 30000) throw new Error("PSD dimensions must be between 1 and 30000");
    const planeSize = width * height * depth / 8;
    const recordSize = 46 + channels * 6;
    const layerSize = 2 + recordSize + channels * (2 + planeSize);
    const paddedLayerSize = layerSize + layerSize % 2;
    if (paddedLayerSize + 8 > 0xffffffff) throw new Error("PSD layer data exceeds the format limit");
    const header = new Uint8Array(62), view = new DataView(header.buffer);
    header.set([56, 66, 80, 83]);
    view.setUint16(4, 1); view.setUint16(12, channels);
    view.setUint32(14, height); view.setUint32(18, width);
    view.setUint16(22, depth); view.setUint16(24, 3);
    view.setUint32(30, 28); // ResolutionInfo resource, with an empty Pascal name.
    header.set([56, 66, 73, 77], 34); view.setUint16(38, 1005); view.setUint32(42, 16);
    const resolution = image.resolution;
    const factor = resolution?.unit === "meter" ? 0.0254 : resolution?.unit === "cm" ? 2.54 : 1;
    view.setUint32(46, Math.round((resolution?.x ?? image.density) * factor * 65536));
    view.setUint16(50, resolution?.unit === "cm" ? 2 : 1); view.setUint16(52, 1);
    view.setUint32(54, Math.round((resolution?.y ?? image.density) * factor * 65536));
    view.setUint16(58, resolution?.unit === "cm" ? 2 : 1); view.setUint16(60, 1);
    yield header;

    const layer = new Uint8Array(10 + recordSize), layerView = new DataView(layer.buffer);
    layerView.setUint32(0, paddedLayerSize + 8); layerView.setUint32(4, paddedLayerSize);
    layerView.setInt16(8, hasAlpha ? -1 : 1); // Negative count marks merged transparency.
    layerView.setUint32(18, height); layerView.setUint32(22, width); layerView.setUint16(26, channels);
    let offset = 28;
    for (let channel = 0; channel < channels; channel++, offset += 6) {
        layerView.setInt16(offset, channel === 3 ? -1 : channel);
        layerView.setUint32(offset + 2, planeSize + 2);
    }
    layer.set([56, 66, 73, 77, 110, 111, 114, 109, 255, 0, 0, 0], offset);
    layer.set([1, 76, 0, 0], offset + 24);
    // Empty mask/ranges, followed by a four-byte Pascal layer name.
    layerView.setUint32(offset + 12, 12);
    yield layer;
    for (const merged of [false, true]) {
        if (merged) yield new Uint8Array(2); // Composite compression.
        for (let channel = 0; channel < channels; channel++) {
            if (!merged) yield new Uint8Array(2); // Layer channel compression.
            for (let pixel = 0; pixel < width * height; pixel += 1024) {
                const samples = yield pixel * 4;
                const bytes = new Uint8Array(samples.length / 4 * depth / 8), samplesView = new DataView(bytes.buffer);
                for (let i = 0; i < samples.length / 4; i++) {
                    if (depth === 16) samplesView.setUint16(i * 2, samples[i * 4 + channel]!);
                    else bytes[i] = samples[i * 4 + channel]!;
                }
                yield bytes;
            }
        }
        if (!merged) yield new Uint8Array(layerSize % 2 + 4); // Even padding and empty global mask.
    }
}

export function encodePsdImage(image: RgbaImage): Uint8Array {
    const samples = image.data16 ?? image.data, steps = psdChunks(image, image.data16 ? 16 : 8);
    const chunks: Uint8Array[] = [];
    let step = steps.next(), size = 0;
    while (!step.done) {
        if (typeof step.value === "number") step = steps.next(samples.subarray(step.value, step.value + 4096));
        else { chunks.push(step.value); size += step.value.length; step = steps.next(); }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function* encodePsdFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const sampleBytes = image.storedData16 ? 2 : 1, position = image.storedData16?.position ?? image.position;
    const steps = psdChunks(image, sampleBytes * 8);
    let step = steps.next();
    while (!step.done) {
        await defaultRuntime.yieldTurn(signal);
        signal.throwIfAborted();
        if (typeof step.value === "number") {
            const length = Math.min(4096, image.width * image.height * 4 - step.value) * sampleBytes;
            const bytes = await storage.read(position + step.value * sampleBytes, length, { signal });
            if (bytes.length !== length) throw new Error("Truncated PSD pixel storage");
            step = steps.next(sampleBytes === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        } else { yield step.value; step = steps.next(); }
    }
}
