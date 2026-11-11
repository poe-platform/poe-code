import { defaultRuntime } from "@poe-code/compression";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";

type PsdImage = Pick<RgbaImage, "width" | "height" | "hasAlpha" | "density" | "resolution" | "virtualCanvas">;

/** PSD v1 / PSB v2: editable RGB layers and their composite, with raw channel planes. */
function* psdChunks(image: PsdImage, layers: readonly PsdImage[], depth: number, format: "psd" | "psb"): Generator<Uint8Array | { image: number; offset: number; length: number }, void, Uint8Array | Uint16Array> {
    const { width, height, hasAlpha } = image, channels = hasAlpha ? 4 : 3;
    const large = format === "psb", lengthBytes = large ? 8 : 4, maxDimension = large ? 300000 : 30000;
    if (layers.length > 32767) throw new Error("Too many Photoshop layers");
    for (const frame of [image, ...layers]) {
        if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width > maxDimension || frame.height > maxDimension) throw new Error(`${format.toUpperCase()} dimensions must be between 1 and ${maxDimension}`);
    }
    const layerSize = 2 + layers.reduce((size, layer) => size + 46 + (layer.hasAlpha ? 4 : 3) * (2 + lengthBytes + 2 + layer.width * layer.height * depth / 8), 0);
    const paddedLayerSize = layerSize + layerSize % 2;
    if (!Number.isSafeInteger(paddedLayerSize + lengthBytes + 4) || (!large && paddedLayerSize + 8 > 0xffffffff)) throw new Error("PSD layer data exceeds the format limit");
    const header = new Uint8Array(62), view = new DataView(header.buffer);
    header.set([56, 66, 80, 83]);
    view.setUint16(4, large ? 2 : 1); view.setUint16(12, channels);
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

    const section = new Uint8Array(lengthBytes * 2 + 2), sectionView = new DataView(section.buffer);
    if (large) {
        sectionView.setBigUint64(0, BigInt(paddedLayerSize + lengthBytes + 4));
        sectionView.setBigUint64(lengthBytes, BigInt(paddedLayerSize));
    } else {
        sectionView.setUint32(0, paddedLayerSize + lengthBytes + 4);
        sectionView.setUint32(lengthBytes, paddedLayerSize);
    }
    sectionView.setInt16(lengthBytes * 2, hasAlpha ? -layers.length : layers.length);
    yield section;
    for (const frame of layers) {
        const channels = frame.hasAlpha ? 4 : 3, planeSize = frame.width * frame.height * depth / 8;
        const layer = new Uint8Array(46 + channels * (2 + lengthBytes)), layerView = new DataView(layer.buffer);
        const x = frame.virtualCanvas?.x ?? 0, y = frame.virtualCanvas?.y ?? 0;
        layerView.setInt32(0, y); layerView.setInt32(4, x);
        layerView.setInt32(8, y + frame.height); layerView.setInt32(12, x + frame.width); layerView.setUint16(16, channels);
        let offset = 18;
        for (let channel = 0; channel < channels; channel++, offset += 2 + lengthBytes) {
            layerView.setInt16(offset, channel === 3 ? -1 : channel);
            if (large) layerView.setBigUint64(offset + 2, BigInt(planeSize + 2));
            else layerView.setUint32(offset + 2, planeSize + 2);
        }
        layer.set([56, 66, 73, 77, 110, 111, 114, 109, 255, 0, 0, 0], offset);
        layer.set([1, 76, 0, 0], offset + 24);
        // Empty mask/ranges, followed by a four-byte Pascal layer name.
        layerView.setUint32(offset + 12, 12);
        yield layer;
    }
    // Layer channel data precedes the composite (image index -1).
    for (let index = 0; index <= layers.length; index++) {
        const merged = index === layers.length, frame = merged ? image : layers[index]!;
        if (merged) {
            yield new Uint8Array(layerSize % 2 + 4); // Even padding and empty global mask.
            yield new Uint8Array(2); // Composite compression.
        }
        for (let channel = 0; channel < (merged ? channels : frame.hasAlpha ? 4 : 3); channel++) {
            if (!merged) yield new Uint8Array(2); // Layer channel compression.
            for (let pixel = 0; pixel < frame.width * frame.height; pixel += 1024) {
                const samples = yield { image: merged ? -1 : index, offset: pixel * 4, length: Math.min(1024, frame.width * frame.height - pixel) * 4 };
                const bytes = new Uint8Array(samples.length / 4 * depth / 8), samplesView = new DataView(bytes.buffer);
                for (let i = 0; i < samples.length / 4; i++) {
                    const sample = samples[i * 4 + channel]!;
                    if (depth === 16) samplesView.setUint16(i * 2, samples instanceof Uint16Array ? sample : sample * 257);
                    else bytes[i] = samples instanceof Uint16Array ? Math.round(sample / 257) : sample;
                }
                yield bytes;
            }
        }
    }
}

export function encodePsdImage(image: RgbaImage, format: "psd" | "psb" = "psd"): Uint8Array {
    const layers = image.psdLayers ?? [image], steps = psdChunks(image, layers, (image.bitsPerSample ?? (image.data16 ? 16 : 8)) <= 8 ? 8 : 16, format);
    const chunks: Uint8Array[] = [];
    let step = steps.next(), size = 0;
    while (!step.done) {
        if (!(step.value instanceof Uint8Array)) {
            const request = step.value, frame = request.image < 0 ? image : layers[request.image]!;
            step = steps.next((frame.data16 ?? frame.data).subarray(request.offset, request.offset + request.length));
        }
        else { chunks.push(step.value); size += step.value.length; step = steps.next(); }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function* encodePsdFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, format: "psd" | "psb" = "psd"): AsyncGenerator<Uint8Array> {
    const layers: StoredRgbaImage[] = [];
    if (image.storedPsdLayers) {
        if (image.storedPsdLayers.length > 32767) throw new Error("Too many Photoshop layers");
        for (let index = 0; index < image.storedPsdLayers.length; index++) {
            signal.throwIfAborted();
            layers.push(await image.storedPsdLayers.at(index));
        }
    } else layers.push(image);
    const steps = psdChunks(image, layers, (image.bitsPerSample ?? (image.storedData16 ? 16 : 8)) <= 8 ? 8 : 16, format);
    let step = steps.next();
    while (!step.done) {
        await defaultRuntime.yieldTurn(signal);
        signal.throwIfAborted();
        if (!(step.value instanceof Uint8Array)) {
            const request = step.value, frame = request.image < 0 ? image : layers[request.image]!;
            const sampleBytes = frame.storedData16 ? 2 : 1, position = frame.storedData16?.position ?? frame.position;
            const length = request.length * sampleBytes;
            const bytes = await storage.read(position + request.offset * sampleBytes, length, { signal });
            if (bytes.length !== length) throw new Error("Truncated PSD pixel storage");
            step = steps.next(sampleBytes === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        } else { yield step.value; step = steps.next(); }
    }
}
