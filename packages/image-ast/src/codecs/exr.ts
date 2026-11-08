import { createByteCodec } from "@poe-code/compression";
import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";

type Range = { position: number; length: number };
type Reads<T> = Generator<Range, T, Uint8Array>;
type Channel = { name: string; type: number };

export function isExrBytes(bytes: Uint8Array): boolean {
    return bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 1;
}

export function* exrHeader(size: number): Reads<{ metadata: ImageMetadata; channels: Channel[]; compression: number; minY: number; offset: number }> {
    let offset = 0;
    function* read(length: number): Reads<Uint8Array> {
        if (length < 0 || offset + length > size) throw new Error("Truncated EXR header");
        const bytes = yield { position: offset, length }; offset += length;
        if (bytes.length !== length) throw new Error("Truncated EXR header");
        return bytes;
    }
    function* name(): Reads<string> {
        let result = "";
        for (let i = 0; i <= 255; i++) {
            const byte = (yield* read(1))[0]!;
            if (!byte) return result;
            result += String.fromCharCode(byte);
        }
        throw new Error("Invalid EXR attribute name");
    }
    const signature = yield* read(8), version = new DataView(signature.buffer, signature.byteOffset, 8).getUint32(4, true);
    if (!isExrBytes(signature) || (version & 255) !== 2 || (version & ~0x402) !== 0) throw new Error("Unsupported EXR layout (requires single-part scanlines)");
    let channels: Channel[] | undefined, compression: number | undefined, window: number[] | undefined;
    const seen = new Set<string>();
    for (;;) {
        const key = yield* name(); if (!key) break;
        if (seen.has(key)) throw new Error("Duplicate EXR attribute"); seen.add(key);
        const type = yield* name(), lengthBytes = yield* read(4), length = new DataView(lengthBytes.buffer, lengthBytes.byteOffset, 4).getUint32(0, true);
        if (offset + length > size) throw new Error("Truncated EXR attribute");
        if (key !== "channels" && key !== "compression" && key !== "dataWindow") { offset += length; continue; }
        if (length > 65536) throw new Error("Invalid EXR attribute size");
        const bytes = yield* read(length), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (key === "compression") {
            if (type !== "compression" || length !== 1 || bytes[0]! > 3) throw new Error("Unsupported EXR compression");
            compression = bytes[0]!;
        } else if (key === "dataWindow") {
            if (type !== "box2i" || length !== 16) throw new Error("Invalid EXR data window");
            window = Array.from({ length: 4 }, (_, i) => view.getInt32(i * 4, true));
        } else {
            if (type !== "chlist") throw new Error("Invalid EXR channels");
            channels = []; let p = 0;
            while (p < length && bytes[p]) {
                const end = bytes.indexOf(0, p);
                if (end < p || end - p > 255 || end + 17 > length) throw new Error("Invalid EXR channel");
                const name = new TextDecoder().decode(bytes.subarray(p, end)); p = end + 1;
                const type = view.getInt32(p, true);
                if (type < 0 || type > 2 || view.getInt32(p + 8, true) !== 1 || view.getInt32(p + 12, true) !== 1) throw new Error("Unsupported EXR channel sampling");
                if (channels.some(channel => channel.name === name)) throw new Error("Duplicate EXR channel");
                channels.push({ name, type }); p += 16;
            }
            if (p !== length - 1 || bytes[p] !== 0) throw new Error("Invalid EXR channel list");
        }
    }
    if (!channels?.length || !window || compression === undefined) throw new Error("Missing EXR attributes");
    const rgb = ["R", "G", "B"].every(name => channels.some(channel => channel.name === name));
    if (!rgb && !channels.some(channel => channel.name === "Y")) throw new Error("Unsupported EXR color channels");
    const width = window[2]! - window[0]! + 1, height = window[3]! - window[1]! + 1;
    if (width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 16)) throw new Error("Invalid EXR dimensions");
    const hasAlpha = channels.some(channel => channel.name === "A");
    const metadata: ImageMetadata = { format: "exr", width, height, channels: rgb ? (hasAlpha ? 4 : 3) : (hasAlpha ? 2 : 1), space: rgb ? "srgb" : "b-w", depth: "float", bitsPerSample: channels.some(channel => channel.type !== 1) ? 32 : 16, hasAlpha, density: 72, size };
    return { metadata, channels, compression, minY: window[1]!, offset };
}

export function readExrHeader(bytes: Uint8Array) {
    const steps = exrHeader(bytes.length); let next = steps.next();
    while (!next.done) next = steps.next(bytes.subarray(next.value.position, next.value.position + next.value.length));
    return next.value;
}

function unpack(bytes: Uint8Array, length: number, compression: number): Uint8Array {
    if (bytes.length === length) return bytes;
    if (bytes.length > length || compression === 0) throw new Error("Invalid EXR chunk size");
    const predicted = new Uint8Array(length); let written = 0;
    if (compression === 1) {
        for (let p = 0; p < bytes.length;) {
            const count = (bytes[p++]! << 24) >> 24;
            const n = count < 0 ? -count : count + 1;
            if (written + n > length || p + (count < 0 ? n : 1) > bytes.length) throw new Error("Invalid EXR RLE chunk");
            if (count < 0) { predicted.set(bytes.subarray(p, p + n), written); p += n; }
            else predicted.fill(bytes[p++]!, written, written + n);
            written += n;
        }
    } else {
        const codec = createByteCodec({ direction: "decode", format: "zlib" });
        try {
            for (const chunk of codec.push(bytes, true)) {
                if (written + chunk.length > length) throw new Error("Invalid EXR ZIP chunk size");
                predicted.set(chunk, written); written += chunk.length;
            }
        } finally { codec.close(); }
    }
    if (written !== length) throw new Error("Truncated EXR compressed chunk");
    for (let i = 1; i < length; i++) predicted[i] = predicted[i - 1]! + predicted[i]! - 128;
    const result = new Uint8Array(length), half = Math.ceil(length / 2);
    for (let i = 0; i < length; i++) result[i] = predicted[(i & 1) ? half + (i >> 1) : i >> 1]!;
    return result;
}

type Pixels = { y: number; data: Uint8Array; data16: Uint16Array; dataFloat: Float32Array };
export function* exrPixels(header: ReturnType<typeof readExrHeader>, size: number): Generator<Range | Pixels, void, Uint8Array> {
    const { metadata: { width, height, space }, channels, compression, minY, offset } = header;
    const rows = compression === 3 ? 16 : 1, count = Math.ceil(height / rows);
    if (offset + count * 8 > size) throw new Error("Truncated EXR offset table");
    const rowBytes = width * channels.reduce((sum, channel) => sum + (channel.type === 1 ? 2 : 4), 0);
    for (let block = 0; block < count; block++) {
        const entry = yield { position: offset + block * 8, length: 8 };
        if (entry.length !== 8) throw new Error("Truncated EXR offset table");
        const position = Number(new DataView(entry.buffer, entry.byteOffset, 8).getBigUint64(0, true));
        if (!Number.isSafeInteger(position) || position < offset + count * 8 || position + 8 > size) throw new Error("Invalid EXR chunk offset");
        const chunk = yield { position, length: 8 };
        if (chunk.length !== 8) throw new Error("Truncated EXR chunk");
        const view = new DataView(chunk.buffer, chunk.byteOffset, 8), y = view.getInt32(0, true) - minY, length = view.getUint32(4, true);
        if (y !== block * rows || position + 8 + length > size) throw new Error("Invalid EXR scanline chunk");
        const lines = Math.min(rows, height - y), expected = lines * rowBytes;
        if (length > expected) throw new Error("Invalid EXR chunk size");
        const packed = yield { position: position + 8, length };
        if (packed.length !== length) throw new Error("Truncated EXR chunk");
        const raw = unpack(packed, expected, compression), samples = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const data = new Uint8Array(width * lines * 4), data16 = new Uint16Array(data.length), dataFloat = new Float32Array(data.length);
        for (let i = 3; i < data.length; i += 4) { data[i] = 255; data16[i] = 65535; dataFloat[i] = 1; }
        let p = 0;
        for (let row = 0; row < lines; row++) for (const channel of channels) for (let x = 0; x < width; x++) {
            let value: number;
            if (channel.type === 1) {
                const bits = samples.getUint16(p, true), exponent = (bits >>> 10) & 31, fraction = bits & 1023, sign = bits & 32768 ? -1 : 1;
                value = exponent === 31 ? (fraction ? NaN : sign * Infinity) : sign * (exponent === 0 ? fraction * 2 ** -24 : (1024 + fraction) * 2 ** (exponent - 25));
                p += 2;
            } else { value = channel.type === 2 ? samples.getFloat32(p, true) : samples.getUint32(p, true); p += 4; }
            const c = channel.name === "A" ? 3 : channel.name === "R" ? 0 : channel.name === "G" ? 1 : channel.name === "B" ? 2 : -1;
            const gray = channel.name === "Y" && space === "b-w";
            if (c < 0 && !gray) continue;
            for (let target = gray ? 0 : c; target <= (gray ? 2 : c); target++) {
                const index = (row * width + x) * 4 + target, bounded = Math.max(0, Math.min(1, value));
                dataFloat[index] = value; data[index] = Math.round(bounded * 255); data16[index] = Math.round(bounded * 65535);
            }
        }
        yield { y, data, data16, dataFloat };
    }
}

export function decodeExrImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const header = readExrHeader(bytes), { width, height } = header.metadata;
    checkLimitInputPixels(width, height, options);
    const data = new Uint8Array(width * height * 4), data16 = new Uint16Array(data.length), dataFloat = new Float32Array(data.length);
    const steps = exrPixels(header, bytes.length); let next = steps.next();
    while (!next.done) {
        const step = next.value;
        if ("position" in step) next = steps.next(bytes.subarray(step.position, step.position + step.length));
        else { const offset = step.y * width * 4; data.set(step.data, offset); data16.set(step.data16, offset); dataFloat.set(step.dataFloat, offset); next = steps.next(new Uint8Array()); }
    }
    return { ...header.metadata, data, data16, dataFloat };
}
