import { defaultRuntime } from "@poe-code/compression";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { netpbmFormat } from "./netpbm-format.js";

function pfmSamples(samples: Uint8Array | Uint16Array | Float32Array, channels: number): Uint8Array {
    const output = new Uint8Array(samples.length / 4 * channels * 4);
    const view = new DataView(output.buffer), maximum = samples instanceof Float32Array ? 1 : samples instanceof Uint16Array ? 65535 : 255;
    for (let pixel = 0; pixel < samples.length / 4; pixel++) for (let channel = 0; channel < channels; channel++) {
        view.setFloat32((pixel * channels + channel) * 4, samples[pixel * 4 + channel]! / maximum);
    }
    return output;
}

export function encodePfmImage(image: RgbaImage): { data: Uint8Array; format: "pfm"; channels: 1 | 3 } {
    const samples = image.dataFloat ?? image.data16 ?? image.data;
    const channels = image.dataFloat ? image.channels === 1 ? 1 : 3 : netpbmFormat(image.data16 ?? image.data) === "ppm" ? 3 : 1;
    const header = new TextEncoder().encode(`${channels === 3 ? "PF" : "Pf"}\n${image.width} ${image.height}\n1.0\n`);
    const data = new Uint8Array(header.length + image.width * image.height * channels * 4); data.set(header);
    for (let y = image.height - 1; y >= 0; y--) {
        const row = pfmSamples(samples.subarray(y * image.width * 4, (y + 1) * image.width * 4), channels);
        data.set(row, header.length + (image.height - 1 - y) * row.length);
    }
    return { data, format: "pfm", channels };
}

export async function* encodePfmFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, channels: 1 | 3): AsyncGenerator<Uint8Array> {
    yield new TextEncoder().encode(`${channels === 3 ? "PF" : "Pf"}\n${image.width} ${image.height}\n1.0\n`);
    const sampleBytes = image.storedDataFloat ? 4 : image.storedData16 ? 2 : 1, position = image.storedDataFloat?.position ?? image.storedData16?.position ?? image.position;
    for (let y = image.height - 1; y >= 0; y--) for (let x = 0; x < image.width; x += 512) {
        await defaultRuntime.yieldTurn(signal);
        const length = Math.min(512, image.width - x) * 4 * sampleBytes;
        const bytes = await storage.read(position + (y * image.width + x) * 4 * sampleBytes, length, { signal });
        if (bytes.length !== length) throw new Error("Truncated PFM sample storage");
        yield pfmSamples(image.storedDataFloat ? new Float32Array(new Uint8Array(bytes).buffer) : image.storedData16 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes, channels);
    }
}
