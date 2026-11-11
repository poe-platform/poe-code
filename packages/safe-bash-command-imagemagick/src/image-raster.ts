import { decodeImage, type RgbaImage, decodeImageToStorage, tryPdfDecode, UnsupportedStoredResource, UnsupportedImageFormat, type ImageByteSource, type ImageByteStorage, type SharpInputOptions, type StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { FileSystem } from "@poe-code/safe-fs/contracts";

/** Raster file adapters keep PDF indexes and pixels in the caller's storage. */
export async function decodeFileImage(source: ImageByteSource, storage: ImageByteStorage, filesystem: FileSystem, cwd: string, signal: AbortSignal, options: SharpInputOptions): Promise<StoredRgbaImage> {
    try {
        const image = await decodeImageToStorage(source, storage, signal, { ...options, hdrPreserveScanlineOrder: true });
        // ImageMagick imports WebP milliseconds as centisecond ticks.
        if (image.format === "webp" && image.delay) return { ...image, delay: image.delay.map(delay => Math.round(delay / 10) * 10) };
        if (image.format === "exr" && image.storedDataFloat) {
            for (let offset = 0; offset < image.storedDataFloat.length; offset += 4096) {
                signal.throwIfAborted();
                const length = Math.min(4096, image.storedDataFloat.length - offset);
                const bytes = await storage.read(image.storedDataFloat.position + offset * 4, length * 4, { signal });
                const samples = new Float32Array(bytes.slice().buffer), data = new Uint8Array(length), data16 = new Uint16Array(length);
                roundExrSamples(samples, data, data16);
                await storage.write(image.storedDataFloat.position + offset * 4, new Uint8Array(samples.buffer), { signal });
                await storage.write(image.position + offset, data, { signal });
                if (image.storedData16) await storage.write(image.storedData16.position + offset * 2, new Uint8Array(data16.buffer), { signal });
            }
        }
        return image;
    } catch (error) {
        if (!(error instanceof UnsupportedStoredResource) || error instanceof UnsupportedImageFormat) throw error;
        const pdf = await tryPdfDecode(source, storage, filesystem, cwd, signal, options);
        if (pdf) return pdf;
        throw error;
    }
}

/** ImageMagick's OpenEXR Rgba reader imports channels through binary16. */
function roundExrSamples(samples: Float32Array, data: Uint8Array, data16?: Uint16Array): void {
    for (let i = 0; i < samples.length; i++) {
        const value = samples[i]!, magnitude = Math.abs(value);
        let rounded = value;
        if (Number.isFinite(value) && magnitude !== 0) {
            const step = 2 ** Math.max(-24, Math.floor(Math.log2(magnitude)) - 10);
            const scaled = magnitude / step, lower = Math.floor(scaled);
            const nearest = scaled - lower === .5 ? lower + (lower % 2) : Math.round(scaled);
            rounded = Math.sign(value) * (magnitude >= 65520 ? Infinity : nearest * step);
        }
        samples[i] = rounded;
        const bounded = Math.max(0, Math.min(1, rounded));
        data[i] = Math.round(bounded * 255);
        if (data16) data16[i] = Math.round(bounded * 65535);
    }
}

export function decodeMagickImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const image = decodeImage(bytes, options);
    if (image.format === "webp" && image.delay) return { ...image, delay: image.delay.map(delay => Math.round(delay / 10) * 10) };
    if (image.format === "exr" && image.dataFloat) roundExrSamples(image.dataFloat, image.data, image.data16);
    return image;
}
