import { defaultRuntime } from "@poe-code/compression";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";

function header(width: number, height: number): Uint8Array {
    return new TextEncoder().encode(`#?RADIANCE\nGAMMA=1\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
}

function rgbe(samples: Uint8Array | Uint16Array | Float32Array): Uint8Array {
    const output = new Uint8Array(samples.length), maximum = samples instanceof Float32Array ? 1 : samples instanceof Uint16Array ? 65535 : 255;
    for (let offset = 0; offset < samples.length; offset += 4) {
        const channels = [0, 1, 2].map(channel => {
            const value = Math.max(0, samples[offset + channel]! / maximum);
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        const peak = Math.max(...channels);
        if (peak < 1e-32) continue;
        const exponent = Math.min(127, Math.floor(Math.log2(peak)) + 1), scale = 2 ** (8 - exponent);
        for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.min(255, Math.floor(channels[channel]! * scale));
        output[offset + 3] = exponent + 128;
    }
    return output;
}

function* scanline(pixels: Uint8Array): Generator<Uint8Array> {
    const width = pixels.length / 4;
    if (width < 8 || width > 32767) { yield pixels; return; }
    yield Uint8Array.of(2, 2, width >> 8, width & 255);
    for (let channel = 0; channel < 4; channel++) for (let x = 0; x < width; x += 128) {
        const length = Math.min(128, width - x), packet = new Uint8Array(length + 1);
        packet[0] = length;
        for (let i = 0; i < length; i++) packet[i + 1] = pixels[(x + i) * 4 + channel]!;
        yield packet;
    }
}

export function encodeHdrImage(image: RgbaImage): Uint8Array {
    const samples = image.dataFloat ?? image.data16 ?? image.data;
    const chunks = [header(image.width, image.height)];
    for (let y = 0; y < image.height; y++) chunks.push(...scanline(rgbe(samples.subarray(y * image.width * 4, (y + 1) * image.width * 4))));
    const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
}

export async function* encodeHdrFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    yield header(image.width, image.height);
    const sampleBytes = image.storedDataFloat ? 4 : image.storedData16 ? 2 : 1;
    const position = image.storedDataFloat?.position ?? image.storedData16?.position ?? image.position;
    for (let y = 0; y < image.height; y++) {
        const planar = image.width >= 8 && image.width <= 32767;
        const row = planar ? new Uint8Array(image.width * 4) : undefined;
        for (let x = 0; x < image.width; x += 512) {
            await defaultRuntime.yieldTurn(signal);
            const length = Math.min(512, image.width - x) * 4 * sampleBytes;
            const bytes = await storage.read(position + (y * image.width + x) * 4 * sampleBytes, length, { signal });
            if (bytes.length !== length) throw new Error("Truncated HDR sample storage");
            const pixels = rgbe(image.storedDataFloat ? new Float32Array(new Uint8Array(bytes).buffer) : image.storedData16 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
            if (row) row.set(pixels, x * 4); else yield pixels;
        }
        if (row) yield* scanline(row);
    }
}
