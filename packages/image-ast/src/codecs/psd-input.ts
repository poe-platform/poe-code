import { defaultRuntime } from "@poe-code/compression";
import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";

type Read = { offset: number; length: number };
type Channel = { id: number; offset: number; length: number };
type Frame = { width: number; height: number; x: number; y: number; channels: Channel[] };

export function isPsdBytes(bytes: Uint8Array): boolean {
    return bytes[0] === 56 && bytes[1] === 66 && bytes[2] === 80 && bytes[3] === 83;
}

function* read(offset: number, length: number, end: number): Generator<Read, Uint8Array, Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > end) throw new Error("Truncated PSD input");
    const bytes = yield { offset, length };
    if (bytes.length !== length) throw new Error("Truncated PSD input");
    return bytes;
}
function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }

function* psdHeader(size: number, options?: SharpInputOptions): Generator<Read, { metadata: ImageMetadata; frame: Frame; depth: number; baseChannels: number; composite: boolean }, Uint8Array> {
    const header = yield* read(0, 26, size), h = view(header);
    if (!isPsdBytes(header) || h.getUint16(4) !== 1) throw new Error("Unsupported PSD version");
    const channels = h.getUint16(12), height = h.getUint32(14), width = h.getUint32(18), depth = h.getUint16(22), mode = h.getUint16(24);
    const baseChannels = mode === 1 ? 1 : 3;
    if (![1, 3].includes(mode) || ![8, 16].includes(depth) || channels < baseChannels || channels > 56) throw new Error("Unsupported PSD encoding");
    if (!width || !height || width > 30000 || height > 30000) throw new Error("Invalid PSD dimensions");
    let offset = 26;
    const colorLength = view(yield* read(offset, 4, size)).getUint32(0);
    offset += 4 + colorLength;
    const resourceLength = view(yield* read(offset, 4, size)).getUint32(0), resourceEnd = offset + 4 + resourceLength;
    offset += 4;
    let resolution: ImageMetadata["resolution"];
    while (offset < resourceEnd) {
        const resource = view(yield* read(offset, 7, resourceEnd)), id = resource.getUint16(4), nameLength = resource.getUint8(6);
        offset += 6 + Math.ceil((nameLength + 1) / 2) * 2;
        const length = view(yield* read(offset, 4, resourceEnd)).getUint32(0);
        offset += 4;
        if (id === 1005 && length === 16) {
            const value = view(yield* read(offset, 16, resourceEnd));
            resolution = { x: value.getUint32(0) / 65536, y: value.getUint32(8) / 65536, unit: "inch" };
        }
        offset += length + length % 2;
        if (offset > resourceEnd) throw new Error("Truncated PSD resources");
    }
    const layerLength = view(yield* read(offset, 4, size)).getUint32(0), layerEnd = offset + 4 + layerLength;
    if (layerEnd > size) throw new Error("Truncated PSD layers");
    offset += 4;
    const frames: Frame[] = [];
    if (layerLength) {
        const infoLength = view(yield* read(offset, 4, layerEnd)).getUint32(0), infoEnd = offset + 4 + infoLength;
        if (infoEnd > layerEnd) throw new Error("Truncated PSD layers");
        offset += 4;
        if (infoLength) {
            const count = Math.abs(view(yield* read(offset, 2, infoEnd)).getInt16(0)); offset += 2;
            for (let i = 0; i < count; i++) {
                const record = view(yield* read(offset, 18, infoEnd)); offset += 18;
                const y = record.getInt32(0), x = record.getInt32(4), layerHeight = record.getInt32(8) - y, layerWidth = record.getInt32(12) - x, channelCount = record.getUint16(16);
                if (layerWidth <= 0 || layerHeight <= 0 || layerWidth > 30000 || layerHeight > 30000 || channelCount > 56) throw new Error("Unsupported PSD layer dimensions or channels");
                const layerChannels: Channel[] = [];
                for (let channel = 0; channel < channelCount; channel++) {
                    const value = view(yield* read(offset, 6, infoEnd)); offset += 6;
                    layerChannels.push({ id: value.getInt16(0), length: value.getUint32(2), offset: 0 });
                }
                const blend = view(yield* read(offset, 16, infoEnd)); offset += 16 + blend.getUint32(12);
                if (offset > infoEnd) throw new Error("Truncated PSD layer record");
                frames.push({ width: layerWidth, height: layerHeight, x, y, channels: layerChannels });
            }
            for (const frame of frames) for (const channel of frame.channels) {
                channel.offset = offset; offset += channel.length;
                if (offset > infoEnd) throw new Error("Truncated PSD layer channel");
            }
        }
    }
    const page = options?.page ?? 0;
    if (!Number.isInteger(page) || page < 0 || page > frames.length) throw new Error("PSD page out of range");
    const frame: Frame = page ? frames[page - 1]! : { width, height, x: 0, y: 0, channels: Array.from({ length: channels }, (_, id) => ({ id: id === baseChannels ? -1 : id, offset: layerEnd, length: size - layerEnd })) };
    checkLimitInputPixels(frame.width, frame.height, options);
    const hasAlpha = frame.channels.some(channel => channel.id === -1);
    const metadata: ImageMetadata = { format: "psd", width: frame.width, height: frame.height, channels: baseChannels === 1 ? (hasAlpha ? 2 : 1) : (hasAlpha ? 4 : 3), space: mode === 1 ? "b-w" : "srgb", depth: depth === 16 ? "ushort" : "uchar", bitsPerSample: depth, hasAlpha, pages: frames.length + 1, size, density: resolution?.x ?? 72, ...(resolution ? { resolution } : {}), virtualCanvas: { width, height, x: frame.x, y: frame.y } };
    return { metadata, frame, depth, baseChannels, composite: page === 0 };
}

function* psdRows(header: ReturnType<typeof readPsdHeader>): Generator<Read | { row: number; data: Uint8Array; data16?: Uint16Array }, void, Uint8Array> {
    const { frame, depth, baseChannels } = header, bytesPerRow = frame.width * depth / 8;
    const { composite } = header;
    const planes: { channel: Channel; offset: number; lengths?: Uint16Array }[] = [];
    let compositeOffset = frame.channels[0]!.offset + 2;
    const compositeCompression = composite ? view(yield* read(frame.channels[0]!.offset, 2, frame.channels[0]!.offset + frame.channels[0]!.length)).getUint16(0) : 0;
    if (compositeCompression === 1) compositeOffset += frame.channels.length * frame.height * 2;
    for (let index = 0; index < frame.channels.length; index++) {
        const channel = frame.channels[index]!, end = channel.offset + channel.length;
        const compression = composite ? compositeCompression : view(yield* read(channel.offset, 2, end)).getUint16(0);
        if (compression !== 0 && compression !== 1) throw new Error("Unsupported PSD compression");
        let offset = composite ? compositeOffset : channel.offset + 2;
        let lengths: Uint16Array | undefined;
        if (compression === 1) {
            const tableOffset = composite ? channel.offset + 2 + index * frame.height * 2 : offset;
            const table = view(yield* read(tableOffset, frame.height * 2, end));
            lengths = new Uint16Array(frame.height);
            for (let row = 0; row < frame.height; row++) lengths[row] = table.getUint16(row * 2);
            if (!composite) offset += frame.height * 2;
        }
        const length = lengths ? lengths.reduce((sum, length) => sum + length, 0) : bytesPerRow * frame.height;
        if (offset + length > end) throw new Error("Truncated PSD channel");
        planes.push({ channel, offset, ...(lengths ? { lengths } : {}) });
        if (composite) compositeOffset = offset + length;
    }
    for (let row = 0; row < frame.height; row++) {
        const data = new Uint8Array(frame.width * 4), data16 = depth === 16 ? new Uint16Array(frame.width * 4) : undefined;
        for (let x = 0; x < frame.width; x++) { data[x * 4 + 3] = 255; if (data16) data16[x * 4 + 3] = 65535; }
        for (const plane of planes) {
            const length = plane.lengths?.[row] ?? bytesPerRow;
            const encoded = yield* read(plane.offset, length, plane.channel.offset + plane.channel.length); plane.offset += length;
            if (plane.channel.id < -1 || plane.channel.id >= baseChannels) continue;
            let samples = encoded;
            if (plane.lengths) {
                samples = new Uint8Array(bytesPerRow);
                let source = 0, target = 0;
                while (source < encoded.length) {
                    const code = encoded[source++]!;
                    if (code === 128) continue;
                    const count = code < 128 ? code + 1 : 257 - code, inputLength = code < 128 ? count : 1;
                    if (source + inputLength > encoded.length || target + count > samples.length) throw new Error("Invalid PSD RLE row");
                    if (code < 128) samples.set(encoded.subarray(source, source + count), target);
                    else samples.fill(encoded[source]!, target, target + count);
                    source += inputLength; target += count;
                }
                if (target !== samples.length) throw new Error("Truncated PSD RLE row");
            }
            for (let x = 0; x < frame.width; x++) {
                const sample = depth === 16 ? samples[x * 2]! * 256 + samples[x * 2 + 1]! : samples[x]! * 257;
                const components = plane.channel.id === -1 ? [3] : baseChannels === 1 ? [0, 1, 2] : [plane.channel.id];
                for (const component of components) { data[x * 4 + component] = Math.round(sample / 257); if (data16) data16[x * 4 + component] = sample; }
            }
        }
        // PSD merged RGB pixels carry a white matte; layer samples are straight.
        if (composite && baseChannels === 3 && header.metadata.hasAlpha) {
            for (let x = 0; x < frame.width; x++) {
                const alpha = data16 ? data16[x * 4 + 3]! : data[x * 4 + 3]! * 257;
                for (let channel = 0; channel < 3; channel++) {
                    const index = x * 4 + channel, sample = data16 ? data16[index]! : data[index]! * 257;
                    const straight = alpha ? Math.max(0, Math.min(65535, (sample + alpha - 65535) * 65535 / alpha)) : 0;
                    data[index] = Math.round(straight / 257);
                    if (data16) data16[index] = Math.round(straight);
                }
            }
        }
        yield { row, data, ...(data16 ? { data16 } : {}) };
    }
}

export function readPsdHeader(bytes: Uint8Array, options?: SharpInputOptions) {
    const steps = psdHeader(bytes.length, options); let next = steps.next();
    while (!next.done) next = steps.next(bytes.subarray(next.value.offset, next.value.offset + next.value.length));
    return next.value;
}

export function decodePsdImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const header = readPsdHeader(bytes, options), data = new Uint8Array(header.metadata.width * header.metadata.height * 4), data16 = header.depth === 16 ? new Uint16Array(data.length) : undefined;
    const steps = psdRows(header); let next = steps.next();
    while (!next.done) {
        if ("offset" in next.value) next = steps.next(bytes.subarray(next.value.offset, next.value.offset + next.value.length));
        else { const offset = next.value.row * header.metadata.width * 4; data.set(next.value.data, offset); if (data16) data16.set(next.value.data16!, offset); next = steps.next(); }
    }
    return { ...header.metadata, data, ...(data16 ? { data16 } : {}) };
}

export async function readPsdFromSource(source: ImageByteSource, signal: AbortSignal, options?: SharpInputOptions) {
    const steps = psdHeader(source.size, options); let next = steps.next();
    while (!next.done) { await defaultRuntime.yieldTurn(signal); next = steps.next(await source.read(next.value.offset, next.value.length, { signal })); }
    return next.value;
}

export async function decodePsdToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
    const header = await readPsdFromSource(source, signal, options), { metadata } = header;
    const position = storage.allocate(metadata.width * metadata.height * 4), storedData16 = header.depth === 16 ? { position: storage.allocate(metadata.width * metadata.height * 8), length: metadata.width * metadata.height * 4 } : undefined;
    const steps = psdRows(header); let next = steps.next();
    while (!next.done) {
        await defaultRuntime.yieldTurn(signal);
        if ("offset" in next.value) next = steps.next(await source.read(next.value.offset, next.value.length, { signal }));
        else {
            await storage.write(position + next.value.row * metadata.width * 4, next.value.data, { signal });
            if (storedData16) await storage.write(storedData16.position + next.value.row * metadata.width * 8, new Uint8Array(next.value.data16!.buffer), { signal });
            next = steps.next();
        }
    }
    return { ...metadata, position, ...(storedData16 ? { storedData16 } : {}) };
}
