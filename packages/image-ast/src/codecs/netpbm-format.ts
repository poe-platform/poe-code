import { defaultRuntime } from "@poe-code/compression";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";

export function netpbmFormat(samples: Uint8Array | Uint16Array | Float32Array): "pbm" | "pgm" | "ppm" {
    const maximum = samples instanceof Float32Array ? 1 : samples instanceof Uint16Array ? 65535 : 255;
    let format: "pbm" | "pgm" = "pbm";
    for (let i = 0; i < samples.length; i += 4) {
        const r = samples[i]!;
        if (r !== samples[i + 1] || r !== samples[i + 2]) return "ppm";
        if (r !== 0 && r !== maximum) format = "pgm";
    }
    return format;
}

export async function storedNetpbmFormat(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): Promise<"pbm" | "pgm" | "ppm"> {
    let format: "pbm" | "pgm" = "pbm";
    const sampleBytes = image.storedData16 ? 2 : 1;
    const position = image.storedData16?.position ?? image.position;
    for (let offset = 0; offset < image.width * image.height; offset += 512) {
        signal.throwIfAborted();
        if (offset % 16384 === 0) await defaultRuntime.yieldTurn(signal);
        const length = Math.min(512, image.width * image.height - offset) * 4 * sampleBytes;
        const bytes = await storage.read(position + offset * 4 * sampleBytes, length, { signal });
        if (bytes.length !== length) throw new Error("Truncated Netpbm sample storage");
        const selected = netpbmFormat(image.storedData16 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        if (selected === "ppm") return selected;
        if (selected === "pgm") format = selected;
    }
    return format;
}
