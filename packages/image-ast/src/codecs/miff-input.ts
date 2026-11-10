import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";

export interface MiffHeader {
    metadata: ImageMetadata & { magickColorspace: string };
    offset: number;
    colors: number;
    pixelBytes: number;
}

export function isMiffBytes(bytes: Uint8Array): boolean {
    return new TextDecoder().decode(bytes.subarray(0, 14)) === "id=ImageMagick";
}

function* miffFrameHeader(size: number): Generator<number, MiffHeader, number | undefined> {
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
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 16)) throw new Error("Invalid MIFF dimensions");
    const colorspace = fields.get("colorspace") ?? "sRGB", gray = colorspace === "Gray";
    const hasAlpha = fields.get("matte")?.toLowerCase() === "true" || fields.get("alpha-trait") === "Blend";
    const channels = gray ? hasAlpha ? 2 : 1 : hasAlpha ? 4 : 3;
    const floating = fields.get("quantum:format") === "floating-point";
    const indexed = fields.get("class") === "PseudoClass", colors = Number(fields.get("colors") ?? 0);
    const sampleBytes = depth / 8, indexBytes = Math.max(sampleBytes, colors > 256 ? 2 : 1);
    const pixelBytes = indexed ? indexBytes + (hasAlpha ? sampleBytes : 0) : channels * sampleBytes;
    if ((!indexed && fields.get("class") !== "DirectClass") || (fields.get("compression") ?? "None") !== "None" || !(indexed ? [8, 16] : [8, 16, 32]).includes(depth) || !["sRGB", "RGB", "Gray"].includes(colorspace) && (fields.get("class") !== "DirectClass" || !["CIELab", "XYZ", "HSL", "YCbCr"].includes(colorspace))
        || floating && (indexed || ![16, 32].includes(depth))
        || indexed && (!Number.isSafeInteger(colors) || colors < 1 || colors > 65536)
        || Number(fields.get("number-meta-channels") ?? 0) !== 0
        || Number(fields.get("number-channels") ?? channels + Number(indexed)) !== channels + Number(indexed) || fields.has("quantum:format") && fields.get("quantum:format") !== "unsigned" && !floating
        || [...fields.keys()].some(key => key.startsWith("profile:") || key === "montage")) throw new Error("Unsupported MIFF encoding");
    if (indexed && size - offset < colors * 3 * sampleBytes) throw new Error("Truncated MIFF palette");
    if (size - offset < (indexed ? colors * 3 * sampleBytes : 0) + width * height * pixelBytes) throw new Error("Truncated MIFF raster");
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
    const delay = Number(fields.get("delay") ?? 0), ticksPerSecond = Number(fields.get("ticks-per-second") ?? 100) || 100;
    if (!Number.isSafeInteger(delay) || delay < 0 || !Number.isSafeInteger(ticksPerSecond) || ticksPerSecond < 0) throw new Error("Invalid MIFF timing");
    return { metadata: { ...(orientation ? { orientation } : {}), ...(virtualCanvas ? { virtualCanvas } : {}), delay: [delay * 1000 / ticksPerSecond], ticksPerSecond, format: "miff", width, height, channels, hasAlpha, depth: floating ? "float" : depth === 32 ? "uint" : depth === 16 ? "ushort" : "uchar", bitsPerSample: depth, space: gray ? "b-w" : "srgb", magickColorspace: colorspace, density: 72, size, ...(indexed ? { isPalette: true } : {}) }, offset, colors: indexed ? colors : 0, pixelBytes };
}

/** Scan adjacent rasters and collect animation timing without reading their pixels. */
export function* miffHeader(size: number, page = 0): Generator<number, MiffHeader, number | undefined> {
    if (!Number.isSafeInteger(page) || page < 0) throw new RangeError("MIFF page out of range");
    let start = 0, pages = 0;
    const delay: number[] = [];
    let selected: ReturnType<typeof readMiffHeader> | undefined;
    while (start < size) {
        const steps = miffFrameHeader(size - start);
        let next = steps.next();
        while (!next.done) next = steps.next(yield start + next.value);
        const { metadata, offset, colors, pixelBytes } = next.value;
        delay.push(metadata.delay![0]!);
        if (pages++ === page) selected = { ...next.value, metadata: { ...metadata, size }, offset: start + offset };
        start += offset + colors * 3 * (metadata.depth === "ushort" ? 2 : 1) + metadata.width * metadata.height * pixelBytes;
    }
    if (!selected) throw new RangeError("MIFF page out of range");
    return { ...selected, metadata: { ...selected.metadata, delay, ...(pages > 1 ? { pages } : {}) } };
}

export function readMiffHeader(bytes: Uint8Array, page?: number) {
    const steps = miffHeader(bytes.length, page); let next = steps.next();
    while (!next.done) next = steps.next(bytes[next.value]);
    return next.value;
}

export function miffPixels(bytes: Uint8Array, metadata: ImageMetadata, palette?: Uint8Array) {
    const { channels, hasAlpha } = metadata, sampleBytes = metadata.bitsPerSample! / 8;
    const colors = palette ? palette.length / (3 * sampleBytes) : 0, indexBytes = Math.max(sampleBytes, colors > 256 ? 2 : 1);
    const pixelBytes = palette ? indexBytes + (hasAlpha ? sampleBytes : 0) : channels * sampleBytes;
    const count = bytes.length / pixelBytes, data = new Uint8Array(count * 4), data16 = sampleBytes > 1 ? new Uint16Array(count * 4) : undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), gray = channels < 3;
    const colormap = palette ? new DataView(palette.buffer, palette.byteOffset, palette.byteLength) : undefined;
    for (let pixel = 0; pixel < count; pixel++) {
        const index = colormap ? indexBytes === 2 ? view.getUint16(pixel * pixelBytes) : bytes[pixel * pixelBytes]! : 0;
        if (colormap && index >= colors) throw new Error("Invalid MIFF palette index");
        for (let channel = 0; channel < 4; channel++) {
            const source = colormap ? channel === 3 ? pixel * pixelBytes + indexBytes : (index * 3 + channel) * sampleBytes
                : (pixel * channels + (channel === 3 ? channels - 1 : gray ? 0 : channel)) * sampleBytes;
            const samples = channel < 3 && colormap ? colormap : view;
            let value: number;
            if (channel === 3 && !hasAlpha) value = 65535;
            else if (metadata.depth === "float") {
                if (sampleBytes === 4) value = samples.getFloat32(source);
                else {
                    const half = samples.getUint16(source), exponent = (half >>> 10) & 31, fraction = half & 1023;
                    value = exponent === 0 ? fraction * 2 ** -24 : exponent === 31 ? fraction ? NaN : Infinity : (1 + fraction / 1024) * 2 ** (exponent - 15);
                    if (half & 0x8000) value = -value;
                }
                value = Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value)) * 65535;
            } else value = sampleBytes === 4 ? samples.getUint32(source) / 65537 : sampleBytes === 2 ? samples.getUint16(source) : samples.getUint8(source) * 257;
            data[pixel * 4 + channel] = Math.round(value / 257);
            if (data16) data16[pixel * 4 + channel] = Math.round(value);
        }
    }
    return { data, ...(data16 ? { data16 } : {}) };
}

export function decodeMiffImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const { metadata, offset, colors, pixelBytes } = readMiffHeader(bytes, options?.page);
    checkLimitInputPixels(metadata.width, metadata.height, options);
    const paletteLength = colors * 3 * (metadata.depth === "ushort" ? 2 : 1), start = offset + paletteLength;
    const length = metadata.width * metadata.height * pixelBytes;
    return { ...metadata, ...miffPixels(bytes.subarray(start, start + length), metadata, colors ? bytes.subarray(offset, start) : undefined) };
}
