import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";

export function isMiffBytes(bytes: Uint8Array): boolean {
    return new TextDecoder().decode(bytes.subarray(0, 14)) === "id=ImageMagick";
}

export function* miffHeader(size: number): Generator<number, { metadata: ImageMetadata & { magickColorspace: string }; offset: number }, number | undefined> {
    let offset = 0, text = "", quote = "";
    while (true) {
        const byte = yield offset++;
        if (byte === undefined) throw new Error("Truncated MIFF header");
        if (offset > 65536) throw new Error("MIFF header exceeds limit");
        const char = String.fromCharCode(byte);
        if (!quote && char === ":" && (yield offset) === 26) { offset++; break; }
        if (quote) { if (char === quote) quote = ""; }
        else if (char === "{") quote = "}";
        else if (char === '"' || char === "'") quote = char;
        text += char;
    }
    const fields = new Map<string, string>();
    let index = 0;
    while (index < text.length) {
        while (index < text.length && text.charCodeAt(index) <= 32) index++;
        const start = index;
        while (index < text.length && text[index] !== "=" && text.charCodeAt(index) > 32) index++;
        const key = text.slice(start, index);
        if (text[index] !== "=") { if (index === start) index++; continue; }
        index++;
        const delimiter = text[index] === "{" ? "}" : text[index] === '"' || text[index] === "'" ? text[index] : undefined;
        if (delimiter) index++;
        const valueStart = index;
        while (index < text.length && (delimiter ? text[index] !== delimiter : text.charCodeAt(index) > 32)) index++;
        fields.set(key, text.slice(valueStart, index));
        if (delimiter) index++;
    }
    const width = Number(fields.get("columns")), height = Number(fields.get("rows")), depth = Number(fields.get("depth"));
    if (fields.get("id") !== "ImageMagick") throw new Error("Invalid MIFF signature");
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 8)) throw new Error("Invalid MIFF dimensions");
    const colorspace = fields.get("colorspace") ?? "sRGB", gray = colorspace === "Gray";
    const hasAlpha = fields.get("matte")?.toLowerCase() === "true" || fields.get("alpha-trait") === "Blend";
    const channels = gray ? hasAlpha ? 2 : 1 : hasAlpha ? 4 : 3;
    if (fields.get("class") !== "DirectClass" || (fields.get("compression") ?? "None") !== "None" || ![8, 16].includes(depth) || !["sRGB", "RGB", "Gray"].includes(colorspace)
        || Number(fields.get("colors") ?? 0) !== 0 || Number(fields.get("number-meta-channels") ?? 0) !== 0
        || Number(fields.get("number-channels") ?? channels) !== channels || fields.has("quantum:format") && fields.get("quantum:format") !== "unsigned"
        || [...fields.keys()].some(key => key.startsWith("profile:") || key === "montage")) throw new Error("Unsupported MIFF encoding");
    if (size - offset < width * height * channels * (depth / 8)) throw new Error("Truncated MIFF raster");
    const delay = Number(fields.get("delay") ?? 0), ticksPerSecond = Number(fields.get("ticks-per-second") ?? 100) || 100;
    if (!Number.isSafeInteger(delay) || delay < 0 || !Number.isSafeInteger(ticksPerSecond) || ticksPerSecond < 0) throw new Error("Invalid MIFF timing");
    return { metadata: { delay: [delay * 1000 / ticksPerSecond], ticksPerSecond, format: "miff", width, height, channels, hasAlpha, depth: depth === 16 ? "ushort" : "uchar", bitsPerSample: depth, space: gray ? "b-w" : "srgb", magickColorspace: colorspace, density: 72, size }, offset };
}

export function readMiffHeader(bytes: Uint8Array) {
    const steps = miffHeader(bytes.length); let next = steps.next();
    while (!next.done) next = steps.next(bytes[next.value]);
    return next.value;
}

export function miffPixels(bytes: Uint8Array, metadata: ImageMetadata) {
    const { channels, hasAlpha, depth } = metadata, sampleBytes = depth === "ushort" ? 2 : 1;
    const count = bytes.length / (channels * sampleBytes), data = new Uint8Array(count * 4), data16 = sampleBytes === 2 ? new Uint16Array(count * 4) : undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), gray = channels < 3;
    for (let pixel = 0; pixel < count; pixel++) for (let channel = 0; channel < 4; channel++) {
        const source = pixel * channels + (channel === 3 ? channels - 1 : gray ? 0 : channel);
        const value = channel === 3 && !hasAlpha ? 65535 : sampleBytes === 2 ? view.getUint16(source * 2) : bytes[source]! * 257;
        data[pixel * 4 + channel] = Math.round(value / 257);
        if (data16) data16[pixel * 4 + channel] = value;
    }
    return { data, ...(data16 ? { data16 } : {}) };
}

export function decodeMiffImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const { metadata, offset } = readMiffHeader(bytes);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const length = metadata.width * metadata.height * metadata.channels * (metadata.depth === "ushort" ? 2 : 1);
    return { ...metadata, ...miffPixels(bytes.subarray(offset, offset + length), metadata) };
}
