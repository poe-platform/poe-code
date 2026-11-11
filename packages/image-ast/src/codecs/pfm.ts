import type { RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import { floatmapSequenceSteps, type FloatmapHeader } from "./floatmap-sequence.js";

export function isPfmBytes(bytes: Uint8Array): boolean {
    return bytes[0] === 80 && (bytes[1] === 70 || bytes[1] === 102) && (bytes[2] === 10 || bytes[2] === 13 || bytes[2] === 32 || bytes[2] === 9);
}

export function* pfmHeader(size: number): Generator<number, FloatmapHeader, number | undefined> {
    let offset = 0, comment = "";
    function* token(): Generator<number, string, number | undefined> {
        let value = "", byte = yield offset++;
        while (byte !== undefined) {
            if (byte <= 32) byte = yield offset++;
            else if (byte === 35) {
                byte = yield offset++;
                while (byte !== undefined && byte !== 10 && byte !== 13) {
                    comment += String.fromCharCode(byte);
                    byte = yield offset++;
                }
                comment += "\n";
            } else break;
        }
        while (byte !== undefined && byte > 32) {
            if (value.length === 64) throw new Error("Invalid PFM header");
            value += String.fromCharCode(byte);
            byte = yield offset++;
        }
        if (!value || byte === undefined) throw new Error("Truncated PFM header");
        if (byte === 13) { if ((yield offset) === 10) offset++; }
        return value;
    }
    const magic = yield* token(), width = Number(yield* token()), height = Number(yield* token()), scale = Number(yield* token());
    if (magic !== "PF" && magic !== "Pf") throw new Error("Invalid PFM signature");
    const channels = magic === "PF" ? 3 : 1;
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 16)) throw new Error("Invalid PFM dimensions");
    if (!Number.isFinite(scale) || scale === 0) throw new Error("Invalid PFM scale");
    if (size - offset < width * height * channels * 4) throw new Error("Truncated PFM raster");
    return { metadata: { format: "pfm", endian: scale < 0 ? "lsb" : "msb", width, height, channels, depth: "float", space: channels === 1 ? "b-w" : "srgb", hasAlpha: false, density: 72, bitsPerSample: 32, size, ...(comment ? { properties: { comment } } : {}) }, offset, little: scale < 0, scale: Math.abs(scale) };
}

export function readPfmHeader(bytes: Uint8Array, page?: number) {
    const steps = floatmapSequenceSteps(bytes.length, pfmHeader, page); let next = steps.next();
    while (!next.done) next = steps.next(bytes[next.value]);
    return next.value;
}

export function pfmPixels(bytes: Uint8Array, channels: number, little: boolean, scale: number) {
    const count = bytes.length / (channels * 4), data = new Uint8Array(count * 4), data16 = new Uint16Array(count * 4), dataFloat = new Float32Array(count * 4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let pixel = 0; pixel < count; pixel++) for (let channel = 0; channel < 4; channel++) {
        const value = channel === 3 ? 1 : view.getFloat32((pixel * channels + (channels === 1 ? 0 : channel)) * 4, little) * scale;
        const bounded = Math.max(0, Math.min(1, value)), index = pixel * 4 + channel;
        dataFloat[index] = value;
        data[index] = Math.round(bounded * 255);
        data16[index] = Math.round(bounded * 65535);
    }
    return { data, data16, dataFloat };
}

export function decodePfmImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const { metadata, offset, little, scale } = readPfmHeader(bytes, options?.page ?? 0), { width, height, channels } = metadata;
    checkLimitInputPixels(width, height, options);
    const data = new Uint8Array(width * height * 4), data16 = new Uint16Array(data.length), dataFloat = new Float32Array(data.length);
    for (let y = 0; y < height; y++) {
        const start = offset + (height - 1 - y) * width * channels * 4;
        const row = pfmPixels(bytes.subarray(start, start + width * channels * 4), channels, little, scale);
        data.set(row.data, y * width * 4); data16.set(row.data16, y * width * 4); dataFloat.set(row.dataFloat, y * width * 4);
    }
    return { ...metadata, data, data16, dataFloat };
}
