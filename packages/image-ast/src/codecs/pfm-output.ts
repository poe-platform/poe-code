import { defaultRuntime } from "@poe-code/compression";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { netpbmFormat, storedNetpbmFormat } from "./netpbm-format.js";

function halfBits(value: number): number {
    const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
    const magnitude = Math.abs(value);
    if (Number.isNaN(magnitude)) return 0x7e00;
    if (magnitude >= 65520) return sign | 0x7c00;
    const exponent = Math.max(-14, Math.floor(Math.log2(magnitude)));
    const scaled = magnitude / 2 ** (exponent - 10);
    const floor = Math.floor(scaled), fraction = scaled - floor;
    const rounded = floor + (fraction > 0.5 || (fraction === 0.5 && floor % 2 !== 0) ? 1 : 0);
    return sign | (exponent === -14 && rounded < 1024 ? rounded : (exponent + 14) * 1024 + rounded);
}

function pfmSamples(samples: Uint8Array | Uint16Array | Float32Array, channels: number, format: "pfm" | "phm", little: boolean): Uint8Array {
    const sampleBytes = format === "phm" ? 2 : 4;
    const output = new Uint8Array(samples.length / 4 * channels * sampleBytes);
    const view = new DataView(output.buffer), maximum = samples instanceof Float32Array ? 1 : samples instanceof Uint16Array ? 65535 : 255;
    for (let pixel = 0; pixel < samples.length / 4; pixel++) for (let channel = 0; channel < channels; channel++) {
        const value = samples[pixel * 4 + channel]! / maximum;
        if (format === "phm") view.setUint16((pixel * channels + channel) * 2, halfBits(value));
        else view.setFloat32((pixel * channels + channel) * 4, value, little);
    }
    return output;
}

export function encodePfmImage(image: RgbaImage, format: "pfm" | "phm" = "pfm", endian?: string): { data: Uint8Array; format: "pfm" | "phm"; channels: 1 | 3 } {
    const little = format === "pfm" && (endian ?? image.endian) === "lsb";
    const samples = image.dataFloat ?? image.data16 ?? image.data;
    const channels = image.dataFloat && image.channels === 1 ? 1 : netpbmFormat(samples) === "ppm" ? 3 : 1;
    const header = new TextEncoder().encode(`${format === "phm" ? channels === 3 ? "PH" : "Ph" : channels === 3 ? "PF" : "Pf"}\n${image.width} ${image.height}\n${little ? "-1.0" : "1.0"}\n`);
    const data = new Uint8Array(header.length + image.width * image.height * channels * (format === "phm" ? 2 : 4)); data.set(header);
    for (let y = image.height - 1; y >= 0; y--) {
        const row = pfmSamples(samples.subarray(y * image.width * 4, (y + 1) * image.width * 4), channels, format, little);
        data.set(row, header.length + (image.height - 1 - y) * row.length);
    }
    return { data, format, channels };
}

export async function storedPfmChannels(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): Promise<1 | 3> {
    if (!image.storedDataFloat) return await storedNetpbmFormat(image, storage, signal) === "ppm" ? 3 : 1;
    if (image.channels === 1) return 1;
    for (let offset = 0; offset < image.width * image.height; offset += 512) {
        signal.throwIfAborted();
        if (offset % 16384 === 0) await defaultRuntime.yieldTurn(signal);
        const length = Math.min(512, image.width * image.height - offset) * 16;
        const bytes = await storage.read(image.storedDataFloat.position + offset * 16, length, { signal });
        if (bytes.length !== length) throw new Error("Truncated PFM sample storage");
        if (netpbmFormat(new Float32Array(new Uint8Array(bytes).buffer)) === "ppm") return 3;
    }
    return 1;
}

export async function* encodePfmFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, channels: 1 | 3, format: "pfm" | "phm" = "pfm", endian?: string): AsyncGenerator<Uint8Array> {
    const little = format === "pfm" && (endian ?? image.endian) === "lsb";
    yield new TextEncoder().encode(`${format === "phm" ? channels === 3 ? "PH" : "Ph" : channels === 3 ? "PF" : "Pf"}\n${image.width} ${image.height}\n${little ? "-1.0" : "1.0"}\n`);
    const sampleBytes = image.storedDataFloat ? 4 : image.storedData16 ? 2 : 1, position = image.storedDataFloat?.position ?? image.storedData16?.position ?? image.position;
    for (let y = image.height - 1; y >= 0; y--) for (let x = 0; x < image.width; x += 512) {
        await defaultRuntime.yieldTurn(signal);
        const length = Math.min(512, image.width - x) * 4 * sampleBytes;
        const bytes = await storage.read(position + (y * image.width + x) * 4 * sampleBytes, length, { signal });
        if (bytes.length !== length) throw new Error("Truncated PFM sample storage");
        yield pfmSamples(image.storedDataFloat ? new Float32Array(new Uint8Array(bytes).buffer) : image.storedData16 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes, channels, format, little);
    }
}
