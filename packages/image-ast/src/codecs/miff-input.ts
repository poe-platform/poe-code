import { miffBzipRaster } from "./miff-bzip-input.js";
import { createByteCodec } from "@poe-code/compression";
import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import { miffLzma, type MiffRead } from "./miff-lzma.js";

export interface MiffHeader {
    metadata: ImageMetadata & { magickColorspace: string; disposal: number };
    offset: number;
    colors: number;
    pixelBytes: number;
    compression: string;
}

export function isMiffBytes(bytes: Uint8Array): boolean {
    return new TextDecoder().decode(bytes.subarray(0, 14)) === "id=ImageMagick";
}

function* miffFrameHeader(size: number): Generator<MiffRead, MiffHeader, Uint8Array> {
    let offset = 0, text = "", quote = "";
    while (true) {
        const byte = (yield { offset: offset++, length: 1 })[0];
        if (byte === undefined) throw new Error("Truncated MIFF header");
        if (offset > 65536) throw new Error("MIFF header exceeds limit");
        const char = String.fromCharCode(byte);
        if (!quote && char === ":" && (yield { offset, length: 1 })[0] === 26) { offset++; break; }
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
    // MIFF stores user properties alongside structural image fields.
    const properties = Object.fromEntries([...fields].filter(([key]) => ![
        "alpha-trait", "background-color", "blue-primary", "border-color", "channel-mask", "class",
        "colors", "colorspace", "columns", "compression", "delay", "depth", "dispose", "endian",
        "gamma", "gravity", "green-primary", "id", "iterations", "matte", "mattecolor", "montage",
        "number-channels", "number-meta-channels", "orientation", "page", "pixel-intensity", "profile",
        "quality", "quantum-format", "quantum:format", "red-primary", "rendering-intent", "resolution",
        "rows", "scene", "ticks-per-second", "tile-offset", "type", "units", "version", "white-point"
    ].includes(key.toLowerCase())));
    const width = Number(fields.get("columns")), height = Number(fields.get("rows")), depth = Number(fields.get("depth"));
    if (fields.get("id") !== "ImageMagick") throw new Error("Invalid MIFF signature");
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 44)) throw new Error("Invalid MIFF dimensions");
    const colorspace = fields.get("colorspace") ?? "sRGB", gray = colorspace === "Gray", cmyk = colorspace === "CMYK";
    const hasAlpha = fields.get("matte")?.toLowerCase() === "true" || fields.get("alpha-trait") === "Blend";
    const channels = cmyk ? hasAlpha ? 5 : 4 : gray ? hasAlpha ? 2 : 1 : hasAlpha ? 4 : 3;
    const floating = fields.get("quantum:format") === "floating-point";
    const indexed = fields.get("class") === "PseudoClass", colors = Number(fields.get("colors") ?? 0);
    const sampleBytes = depth / 8, indexBytes = Math.max(sampleBytes, colors > 256 ? 2 : 1);
    const pixelBytes = indexed ? indexBytes + (hasAlpha ? sampleBytes : 0) : channels * sampleBytes;
    const compression = fields.get("compression") ?? "None";
    if ((!indexed && fields.get("class") !== "DirectClass") || !["None", "LZMA", "Zip", "LZW", "BZip", "RLE"].includes(compression) || indexed && compression !== "None" || !(indexed ? [8, 16] : [8, 16, 32]).includes(depth) || !["sRGB", "RGB", "Gray", "CMYK"].includes(colorspace) && (fields.get("class") !== "DirectClass" || !["CIELab", "XYZ", "HSL", "YCbCr"].includes(colorspace))
        || compression === "LZMA" && (floating || ![8, 16].includes(depth) || !["sRGB", "RGB", "Gray"].includes(colorspace))
        || floating && (indexed || ![16, 32].includes(depth))
        || indexed && (cmyk || !Number.isSafeInteger(colors) || colors < 1 || colors > 65536)
        || Number(fields.get("number-meta-channels") ?? 0) !== 0
        || Number(fields.get("number-channels") ?? channels + Number(indexed)) !== channels + Number(indexed) || fields.has("quantum:format") && fields.get("quantum:format") !== "unsigned" && !floating
        || [...fields.keys()].some(key => key.startsWith("profile:") || key === "montage")) throw new Error("Unsupported MIFF encoding");
    if (indexed && size - offset < colors * 3 * sampleBytes) throw new Error("Truncated MIFF palette");
    if (compression === "None" && size - offset < (indexed ? colors * 3 * sampleBytes : 0) + width * height * pixelBytes) throw new Error("Truncated MIFF raster");
    const gamma = Number(fields.get("gamma"));
    const orientation = ["topleft", "topright", "bottomright", "bottomleft", "lefttop", "righttop", "rightbottom", "leftbottom"].indexOf(fields.get("orientation")?.toLowerCase() ?? "") + 1;
    let virtualCanvas: ImageMetadata["virtualCanvas"];
    const page = fields.get("page");
    if (page !== undefined) {
        const [size, ...offsets] = page.replaceAll("+", " +").replaceAll("-", " -").split(" ");
        const dimensions = size!.split("x").map(Number), [pageWidth, pageHeight] = dimensions;
        const [x = 0, y = 0] = offsets.map(Number);
        if (dimensions.length !== 2 || offsets.length > 2 || dimensions.some(value => !Number.isSafeInteger(value) || value < 0)
            || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error("Invalid MIFF page geometry");
        virtualCanvas = { width: pageWidth!, height: pageHeight!, x, y };
    }
    const disposal = Math.max(0, ["undefined", "none", "background", "previous"].indexOf(fields.get("dispose")?.toLowerCase() ?? "undefined"));
    const delay = Number(fields.get("delay") ?? 0), ticksPerSecond = Number(fields.get("ticks-per-second") ?? 100) || 100;
    if (!Number.isSafeInteger(delay) || delay < 0 || !Number.isSafeInteger(ticksPerSecond) || ticksPerSecond < 0) throw new Error("Invalid MIFF timing");
    const [x = 0, y = x] = (fields.get("resolution") ?? "").split("x").map(Number);
    const unit = fields.get("units") === "PixelsPerInch" ? "inch" : fields.get("units") === "PixelsPerCentimeter" ? "cm" : "unknown";
    const resolution: ImageMetadata["resolution"] = Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 ? { x, y, unit } : undefined;
    return { metadata: { ...(Number.isFinite(gamma) ? { gamma } : {}), disposal, ...(orientation ? { orientation } : {}), ...(virtualCanvas ? { virtualCanvas } : {}), delay: [delay * 1000 / ticksPerSecond], ticksPerSecond, ...(Object.keys(properties).length ? { properties } : {}), format: "miff", width, height, channels, hasAlpha, depth: floating ? "float" : depth === 32 ? "uint" : depth === 16 ? "ushort" : "uchar", bitsPerSample: depth, space: cmyk ? "cmyk" : gray ? "b-w" : "srgb", magickColorspace: colorspace, density: resolution ? x * (unit === "cm" ? 2.54 : 1) : 72, ...(resolution ? { resolution } : {}), size, ...(indexed ? { isPalette: true } : {}) }, offset, colors: indexed ? colors : 0, pixelBytes, compression };
}

/** Scan adjacent frames without retaining their rasters. */
export function* miffHeader(size: number, page = 0, options?: SharpInputOptions): Generator<MiffRead | Uint8Array, MiffHeader, Uint8Array> {
    if (!Number.isSafeInteger(page) || page < 0) throw new RangeError("MIFF page out of range");
    let start = 0, pages = 0;
    const delay: number[] = [];
    let selected: ReturnType<typeof readMiffHeader> | undefined;
    while (start < size) {
        const steps = miffFrameHeader(size - start);
        let next = steps.next();
        while (!next.done) next = steps.next(yield { offset: start + next.value.offset, length: next.value.length });
        const { metadata, offset, colors, pixelBytes, compression } = next.value;
        if (pages === page) checkLimitInputPixels(metadata.width, metadata.height, options);
        delay.push(metadata.delay![0]!);
        if (pages++ === page) selected = { ...next.value, metadata: { ...metadata, size }, offset: start + offset };
        const header = { ...next.value, metadata: { ...metadata, size }, offset: start + offset };
        start += offset + colors * 3 * (metadata.depth === "ushort" ? 2 : 1);
        if (compression === "None") start += metadata.width * metadata.height * pixelBytes;
        else if (compression === "RLE") {
            let remaining = metadata.width * metadata.height;
            while (remaining) {
                if (size - start < pixelBytes + 1) throw new Error("Truncated MIFF raster");
                const repeat = (yield { offset: start + pixelBytes, length: 1 })[0];
                if (repeat === undefined) throw new Error("Truncated MIFF raster");
                remaining -= repeat + 1;
                if (remaining < 0) throw new Error("MIFF run exceeds raster");
                start += pixelBytes + 1;
            }
        } else start = yield* miffRaster(header);
    }
    if (!selected) throw new RangeError("MIFF page out of range");
    return { ...selected, metadata: { ...selected.metadata, delay, ...(pages > 1 ? { pages } : {}) } };
}

export function readMiffHeader(bytes: Uint8Array, page?: number, options?: SharpInputOptions) {
    const steps = miffHeader(bytes.length, page, options); let next = steps.next();
    try {
        while (!next.done) next = next.value instanceof Uint8Array ? steps.next() : steps.next(bytes.subarray(next.value.offset, next.value.offset + next.value.length));
        return next.value;
    } finally { steps.return(undefined!); }
}

export function miffPixels(bytes: Uint8Array, metadata: ImageMetadata, palette?: Uint8Array) {
    const { channels, hasAlpha } = metadata, sampleBytes = metadata.bitsPerSample! / 8;
    const colors = palette ? palette.length / (3 * sampleBytes) : 0, indexBytes = Math.max(sampleBytes, colors > 256 ? 2 : 1);
    const pixelBytes = palette ? indexBytes + (hasAlpha ? sampleBytes : 0) : channels * sampleBytes;
    const count = bytes.length / pixelBytes, data = new Uint8Array(count * 4), data16 = sampleBytes > 1 || metadata.space === "cmyk" ? new Uint16Array(count * 4) : undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), gray = channels < 3;
    const hueSamples = metadata.space === "cmyk" ? new Float64Array(count * 4) : undefined;
    const colormap = palette ? new DataView(palette.buffer, palette.byteOffset, palette.byteLength) : undefined;
    for (let pixel = 0; pixel < count; pixel++) {
        const index = colormap ? indexBytes === 2 ? view.getUint16(pixel * pixelBytes) : bytes[pixel * pixelBytes]! : 0;
        if (colormap && index >= colors) throw new Error("Invalid MIFF palette index");
        for (let channel = 0; channel < (hueSamples ? channels : 4); channel++) {
            const source = colormap ? channel === 3 ? pixel * pixelBytes + indexBytes : (index * 3 + channel) * sampleBytes
                : (pixel * channels + (hueSamples ? channel : channel === 3 ? channels - 1 : gray ? 0 : channel)) * sampleBytes;
            const samples = channel < 3 && colormap ? colormap : view;
            let value: number;
            if (channel === 3 && !hasAlpha && !hueSamples) value = 65535;
            else if (metadata.depth === "float") {
                if (sampleBytes === 4) value = samples.getFloat32(source);
                else {
                    const half = samples.getUint16(source), exponent = (half >>> 10) & 31, fraction = half & 1023;
                    value = exponent === 0 ? fraction * 2 ** -24 : exponent === 31 ? fraction ? NaN : Infinity : (1 + fraction / 1024) * 2 ** (exponent - 15);
                    if (half & 0x8000) value = -value;
                }
                value = Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value)) * 65535;
            } else value = sampleBytes === 4 ? samples.getUint32(source) / 65537 : sampleBytes === 2 ? samples.getUint16(source) : samples.getUint8(source) * 257;
            if (hueSamples && channel < 4) {
                hueSamples[pixel * 4 + channel] = value / 65535;
            } else {
                const target = pixel * 4 + (channel === 4 ? 3 : channel);
                data[target] = Math.round(value / 257);
                if (data16) data16[target] = Math.round(value);
            }
        }
        if (hueSamples) {
            for (let channel = 0; channel < 3; channel++) {
                const value = (1 - hueSamples[pixel * 4 + channel]!) * (1 - hueSamples[pixel * 4 + 3]!) * 65535;
                data[pixel * 4 + channel] = Math.round(value / 257);
                data16![pixel * 4 + channel] = Math.round(value);
            }
            if (!hasAlpha) { data[pixel * 4 + 3] = 255; data16![pixel * 4 + 3] = 65535; }
        }
    }
    return { data, ...(data16 ? { data16 } : {}), ...(hueSamples ? { hueSamples } : {}) };
}

// Read requests and decoded chunks share the same bounded decoder in both paths.
export function* miffRaster(header: ReturnType<typeof readMiffHeader>): Generator<{ offset: number; length: number } | Uint8Array, number, Uint8Array> {
    const { metadata, compression } = header, size = metadata.size!;
    let offset = header.offset + header.colors * 3 * (metadata.depth === "ushort" ? 2 : 1);
    if (compression === "BZip") return yield* miffBzipRaster(header);
    if (compression === "LZMA") return yield* miffLzma(offset, size, header.pixelBytes, metadata.width * metadata.height * header.pixelBytes);
    const stride = header.pixelBytes;
    const chunkBytes = Math.min(1024, Math.floor(8192 / stride)) * stride;
    let remaining = metadata.width * metadata.height * stride;
    function* read(length: number): Generator<{ offset: number; length: number }, Uint8Array, Uint8Array> {
        if (length > size - offset) throw new Error("Truncated MIFF raster");
        const bytes = yield { offset, length };
        if (bytes.length !== length) throw new Error("Truncated MIFF raster");
        offset += length;
        return bytes;
    }
    if (compression === "None") {
        while (remaining) {
            const bytes = yield* read(Math.min(chunkBytes, remaining));
            remaining -= bytes.length;
            yield bytes;
        }
        return offset;
    }
    if (compression === "RLE") {
        let run = 0;
        let sample = new Uint8Array(stride);
        while (remaining) {
            const chunk = new Uint8Array(Math.min(chunkBytes, remaining));
            for (let index = 0; index < chunk.length; index += stride) {
                if (run === 0) {
                    const packet = yield* read(stride + 1);
                    sample = packet.slice(0, stride);
                    run = packet[stride]! + 1;
                    if (run * stride > remaining) throw new Error("MIFF run exceeds raster");
                }
                chunk.set(sample, index);
                run--;
                remaining -= stride;
            }
            yield chunk;
        }
        return offset;
    }
    const codec = createByteCodec({ direction: "decode", format: "zlib", chunkSize: chunkBytes });
    let pending = new Uint8Array(chunkBytes), used = 0;
    try {
        while (remaining || !codec.complete && offset < size) {
            const header = yield* read(4);
            // Finished zlib trailers may occupy another packet; native row-flushed
            // streams instead end at EOF or the next MIFF signature.
            if (!remaining && header[0] === 105 && header[1] === 100 && header[2] === 61 && header[3] === 73) {
                offset -= 4;
                break;
            }
            let packet = new DataView(header.buffer, header.byteOffset, 4).getUint32(0);
            if (!packet || packet > size - offset) throw new Error("Invalid MIFF compressed packet");
            while (packet) {
                const input = yield* read(Math.min(packet, 8192));
                packet -= input.length;
                // Native MIFF flushes rows without a final zlib trailer.
                for (const bytes of codec.push(input)) {
                    if (bytes.length > remaining) throw new Error("Excess MIFF raster data");
                    remaining -= bytes.length;
                    for (let index = 0; index < bytes.length;) {
                        const take = Math.min(pending.length - used, bytes.length - index);
                        pending.set(bytes.subarray(index, index + take), used);
                        used += take;
                        index += take;
                        if (used === pending.length) {
                            yield pending;
                            pending = new Uint8Array(chunkBytes);
                            used = 0;
                        }
                    }
                }
                if (codec.consumed !== input.length) throw new Error("Invalid MIFF compressed packet");
            }
            if (codec.complete && remaining) throw new Error("Truncated MIFF raster");
        }
        if (used) yield pending.subarray(0, used);
    } finally { codec.close(); }
    return offset;
}

export function decodeMiffImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const header = readMiffHeader(bytes, options?.page, options), { metadata } = header;
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const count = metadata.width * metadata.height, data = new Uint8Array(count * 4);
    const hueSamples = metadata.space === "cmyk" ? new Float64Array(count * 4) : undefined;
    const data16 = metadata.bitsPerSample! > 8 || hueSamples ? new Uint16Array(count * 4) : undefined;
    const palette = header.colors ? bytes.subarray(header.offset, header.offset + header.colors * 3 * (metadata.depth === "ushort" ? 2 : 1)) : undefined;
    const steps = miffRaster(header);
    let next = steps.next(), position = 0;
    try {
        while (!next.done) {
            if (next.value instanceof Uint8Array) {
                const pixels = miffPixels(next.value, metadata, palette);
                data.set(pixels.data, position); data16?.set(pixels.data16!, position); hueSamples?.set(pixels.hueSamples!, position);
                position += pixels.data.length;
                next = steps.next();
            } else next = steps.next(bytes.subarray(next.value.offset, next.value.offset + next.value.length));
        }
    } finally { steps.return(header.offset); }
    return { ...metadata, data, ...(data16 ? { data16 } : {}), ...(hueSamples ? { hueSamples } : {}) };
}
