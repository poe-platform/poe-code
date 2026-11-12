import { defaultRuntime } from "@poe-code/compression";
import { createTiffCompressor } from "./tiff-compression.js";
import type { OutputEncodeOptions, RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";

type PsdImage = Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space" | "channels" | "density" | "resolution" | "virtualCanvas">;

export function psdChannels(image: Pick<RgbaImage, "hasAlpha" | "space" | "channels">): 1 | 2 | 3 | 4 | 5 {
    const gray = image.space === "b-w" || image.space === "grey16" || image.channels === 1 || image.channels === 2;
    return image.space === "cmyk" ? image.hasAlpha ? 5 : 4 : gray ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3;
}

type PsdCompression = NonNullable<OutputEncodeOptions["psdCompression"]>;
type PsdStep = Uint8Array | { image: number; offset: number; length: number; ink: boolean };
type PsdSamples = Uint8Array | Uint16Array | Float64Array;

function* psdPlane(frame: PsdImage, index: number, channel: number, baseChannels: number, depth: 8 | 16, compression: PsdCompression): Generator<PsdStep, { size: number; rows: number[] }, PsdSamples> {
    const ink = baseChannels === 4 && channel < baseChannels, chunkPixels = ink ? 512 : 1024;
    const compressor = createTiffCompressor({ tiffCompression: compression === "rle" ? "packbits" : compression === "zip" ? "deflate" : "none", tiffPredictor: 1, tiffIntegerDepth: depth }, frame.width, 1);
    const rowCount = compression === "rle" ? frame.height : 1, columns = compression === "rle" ? frame.width : frame.width * frame.height;
    let size = 0;
    const rows: number[] = [];
    try {
        for (let row = 0; row < rowCount; row++) {
            const start = size;
            for (let column = 0; column < columns; column += chunkPixels) {
                const samples = yield { image: index, offset: (row * columns + column) * 4, length: Math.min(chunkPixels, columns - column) * 4, ink };
                const bytes = new Uint8Array(samples.length / 4 * depth / 8), view = new DataView(bytes.buffer);
                for (let i = 0; i < samples.length / 4; i++) {
                    const sample = samples[i * 4 + (channel === baseChannels ? 3 : channel)]!;
                    if (samples instanceof Float64Array) {
                        const value = Math.round((1 - Math.max(0, Math.min(1, sample))) * (depth === 16 ? 65535 : 255));
                        if (depth === 16) view.setUint16(i * 2, value);
                        else bytes[i] = value;
                    } else if (depth === 16) view.setUint16(i * 2, samples instanceof Uint16Array ? sample : sample * 257);
                    else bytes[i] = samples instanceof Uint16Array ? Math.round(sample / 257) : sample;
                }
                for (const chunk of compressor.push(bytes)) { size += chunk.length; yield chunk; }
            }
            if (compression === "rle") rows.push(size - start);
        }
        for (const chunk of compressor.push(new Uint8Array(), true)) { size += chunk.length; yield chunk; }
        return { size, rows };
    } finally { compressor.close(); }
}

/** PSD v1 / PSB v2: editable RGB, CMYK or grayscale layers and their composite. */
function* psdChunks(image: PsdImage, layers: readonly PsdImage[], depth: 8 | 16, format: "psd" | "psb", compression: PsdCompression): Generator<PsdStep, void, PsdSamples> {
    const { width, height, hasAlpha } = image, channels = psdChannels(image), baseChannels = image.space === "cmyk" ? 4 : channels <= 2 ? 1 : 3;
    const large = format === "psb", lengthBytes = large ? 8 : 4, maxDimension = large ? 300000 : 30000;
    if (layers.length > 32767) throw new Error("Too many Photoshop layers");
    for (const frame of [image, ...layers]) {
        if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width > maxDimension || frame.height > maxDimension) throw new Error(`${format.toUpperCase()} dimensions must be between 1 and ${maxDimension}`);
    }
    const rowLengthBytes = large ? 4 : 2, compressionId = compression === "rle" ? 1 : compression === "zip" ? 2 : 0;
    const channelInfo: { size: number; rows: Uint8Array }[][] = [];
    // Layer sizes and RLE row counts precede their payloads. Count compressed
    // bytes first, then encode again without retaining whole compressed planes.
    for (let index = 0; index <= layers.length; index++) {
        const merged = index === layers.length, frame = merged ? image : layers[index]!;
        const info: { size: number; rows: Uint8Array }[] = [];
        for (let channel = 0; channel < baseChannels + (frame.hasAlpha ? 1 : 0); channel++) {
            let size = frame.width * frame.height * depth / 8;
            let rows = new Uint8Array();
            if (compression === "rle" || (compression === "zip" && !merged)) {
                const steps = psdPlane(frame, merged ? -1 : index, channel, baseChannels, depth, compression);
                try {
                    let step = steps.next();
                    while (!step.done) step = step.value instanceof Uint8Array ? steps.next() : steps.next(yield step.value);
                    size = step.value.size;
                    rows = new Uint8Array(step.value.rows.length * rowLengthBytes);
                    const view = new DataView(rows.buffer);
                    for (const [row, length] of step.value.rows.entries()) {
                        if (!large && length > 65535) throw new Error("PSD RLE row exceeds the format limit");
                        if (large) view.setUint32(row * rowLengthBytes, length);
                        else view.setUint16(row * rowLengthBytes, length);
                    }
                } finally { steps.return({ size: 0, rows: [] }); }
            }
            info.push({ size: size + 2 + rows.length, rows });
        }
        channelInfo.push(info);
    }
    const layerSize = 2 + layers.reduce((size, layer, index) => size + 46 + (baseChannels + (layer.hasAlpha ? 1 : 0)) * (2 + lengthBytes) + channelInfo[index]!.reduce((total, channel) => total + channel.size, 0), 0);
    const paddedLayerSize = layerSize + layerSize % 2;
    if (!Number.isSafeInteger(paddedLayerSize + lengthBytes + 4) || (!large && paddedLayerSize + 8 > 0xffffffff)) throw new Error("PSD layer data exceeds the format limit");
    const resolution = image.resolution;
    const header = new Uint8Array(resolution ? 62 : 34), view = new DataView(header.buffer);
    header.set([56, 66, 80, 83]);
    view.setUint16(4, large ? 2 : 1); view.setUint16(12, channels);
    view.setUint32(14, height); view.setUint32(18, width);
    view.setUint16(22, depth); view.setUint16(24, baseChannels);
    if (resolution) {
        view.setUint32(30, 28); // ResolutionInfo resource, with an empty Pascal name.
        header.set([56, 66, 73, 77], 34); view.setUint16(38, 1005); view.setUint32(42, 16);
        const factor = resolution.unit === "meter" ? 0.0254 : resolution.unit === "cm" ? 2.54 : 1;
        view.setUint32(46, Math.round(resolution.x * factor * 65536));
        view.setUint16(50, resolution.unit === "cm" ? 2 : 1); view.setUint16(52, 1);
        view.setUint32(54, Math.round(resolution.y * factor * 65536));
        view.setUint16(58, resolution.unit === "cm" ? 2 : 1); view.setUint16(60, 1);
    }
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
    for (const [index, frame] of layers.entries()) {
        const channels = baseChannels + (frame.hasAlpha ? 1 : 0);
        const layer = new Uint8Array(46 + channels * (2 + lengthBytes)), layerView = new DataView(layer.buffer);
        const x = frame.virtualCanvas?.x ?? 0, y = frame.virtualCanvas?.y ?? 0;
        layerView.setInt32(0, y); layerView.setInt32(4, x);
        layerView.setInt32(8, y + frame.height); layerView.setInt32(12, x + frame.width); layerView.setUint16(16, channels);
        let offset = 18;
        for (let channel = 0; channel < channels; channel++, offset += 2 + lengthBytes) {
            layerView.setInt16(offset, channel === baseChannels ? -1 : channel);
            if (large) layerView.setBigUint64(offset + 2, BigInt(channelInfo[index]![channel]!.size));
            else layerView.setUint32(offset + 2, channelInfo[index]![channel]!.size);
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
            yield Uint8Array.of(0, compressionId);
            for (const info of channelInfo[index]!) if (info.rows.length) yield info.rows;
        }
        for (let channel = 0; channel < (baseChannels + (frame.hasAlpha ? 1 : 0)); channel++) {
            if (!merged) {
                yield Uint8Array.of(0, compressionId);
                const rows = channelInfo[index]![channel]!.rows;
                if (rows.length) yield rows;
            }
            yield* psdPlane(frame, merged ? -1 : index, channel, baseChannels, depth, compression);
        }
    }
}

export function encodePsdImage(image: RgbaImage, format: "psd" | "psb" = "psd", compression: PsdCompression = "none"): Uint8Array {
    const layers = image.psdLayers ?? [image], steps = psdChunks(image, layers, (image.bitsPerSample ?? (image.data16 ? 16 : 8)) <= 8 ? 8 : 16, format, compression);
    const chunks: Uint8Array[] = [];
    let step = steps.next(), size = 0;
    try {
        while (!step.done) {
            if (!(step.value instanceof Uint8Array)) {
                const request = step.value, frame = request.image < 0 ? image : layers[request.image]!;
                const samples = request.ink ? frame.hueSamples : frame.data16 ?? frame.data;
                if (!samples || samples.length < request.offset + request.length) throw new Error("Truncated PSD pixel samples");
                step = steps.next(samples.subarray(request.offset, request.offset + request.length));
            }
            else { chunks.push(step.value); size += step.value.length; step = steps.next(); }
        }
    } finally { steps.return(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function* encodePsdFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, format: "psd" | "psb" = "psd", compression: PsdCompression = "none"): AsyncGenerator<Uint8Array> {
    const layers: StoredRgbaImage[] = [];
    if (image.storedPsdLayers) {
        if (image.storedPsdLayers.length > 32767) throw new Error("Too many Photoshop layers");
        for (let index = 0; index < image.storedPsdLayers.length; index++) {
            signal.throwIfAborted();
            layers.push(await image.storedPsdLayers.at(index));
        }
    } else layers.push(image);
    const steps = psdChunks(image, layers, (image.bitsPerSample ?? (image.storedData16 ? 16 : 8)) <= 8 ? 8 : 16, format, compression);
    let step = steps.next();
    try {
        while (!step.done) {
            await defaultRuntime.yieldTurn(signal);
            signal.throwIfAborted();
            if (!(step.value instanceof Uint8Array)) {
                const request = step.value, frame = request.image < 0 ? image : layers[request.image]!;
                const sampleBytes = request.ink ? 8 : frame.storedData16 ? 2 : 1, position = request.ink ? frame.storedHueSamples : frame.storedData16?.position ?? frame.position;
                if (position === undefined) throw new Error("Missing PSD CMYK samples");
                const length = request.length * sampleBytes;
                const bytes = await storage.read(position + request.offset * sampleBytes, length, { signal });
                if (bytes.length !== length) throw new Error("Truncated PSD pixel storage");
                step = steps.next(request.ink ? new Float64Array(new Uint8Array(bytes).buffer) : sampleBytes === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
            } else { yield step.value; step = steps.next(); }
        }
    } finally { steps.return(); }
}
