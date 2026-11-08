import { encodeImage as encodeRaster, encodeStoredImage as encodeStoredRaster, type ImageFormat as RasterFormat, type OutputEncodeOptions as RasterOptions, type RgbaImage, type StoredRgbaImage, type ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

export type RawCoder = "rgb" | "rgba" | "bgr" | "bgra" | "gray";
export type ImageFormat = RasterFormat | RawCoder;
export type OutputEncodeOptions = Omit<RasterOptions, "format"> & { format: ImageFormat; endian?: string | undefined; jpegExtent?: number | undefined };
export function isRawCoder(format: string | undefined): format is RawCoder {
    return format === "rgb" || format === "rgba" || format === "bgr" || format === "bgra" || format === "gray";
}

export function encodeImage(image: RgbaImage, options: OutputEncodeOptions): ReturnType<typeof encodeRaster> {
    const format = options.format;
    if (!isRawCoder(format)) {
        let encoded = encodeRaster(image, { ...options, format, synthesizeExif: false });
        if (format === "jpeg" && options.jpegExtent !== undefined && encoded.data.length > options.jpegExtent) {
            let low = 1, high = Math.floor(options.quality ?? 92) - 1;
            let best: typeof encoded | undefined;
            while (low <= high) {
                const quality = Math.floor((low + high) / 2);
                encoded = encodeRaster(image, { ...options, format, quality, chromaSubsampling: quality < 90 ? "4:2:0" : "4:4:4", synthesizeExif: false });
                if (encoded.data.length <= options.jpegExtent) { best = encoded; low = quality + 1; }
                else high = quality - 1;
            }
            return best ?? encoded;
        }
        return encoded;
    }
    const channels = format === "gray" ? 1 : format.endsWith("a") ? 4 : 3;
    const depth = (image.bitsPerSample ?? 8) > 8 ? 16 : 8;
    const data = new Uint8Array(image.width * image.height * channels * depth / 8);
    const view = new DataView(data.buffer), samples = image.data16 ?? image.data;
    const scale = image.data16 ? 65535 : 255, maximum = depth === 16 ? 65535 : 255;
    let offset = 0;
    for (let pixel = 0; pixel < image.width * image.height; pixel++) {
        for (let channel = 0; channel < channels; channel++) {
            const index = format.startsWith("bgr") && channel < 3 ? 2 - channel : channel;
            const value = format === "gray"
                ? 0.212656 * samples[pixel * 4]! + 0.715158 * samples[pixel * 4 + 1]! + 0.072186 * samples[pixel * 4 + 2]!
                : channel === 3 && !image.hasAlpha ? scale : samples[pixel * 4 + index]!;
            const quantum = Math.round(value * maximum / scale);
            if (depth === 16) view.setUint16(offset, quantum, options.endian === undefined || options.endian === "lsb");
            else data[offset] = quantum;
            offset += depth / 8;
        }
    }
    return { data, format: "raw", channels };
}

export async function* encodeStoredImage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, options: OutputEncodeOptions): ReturnType<typeof encodeStoredRaster> {
    if (!isRawCoder(options.format)) {
        let quality = options.quality ?? 92;
        if (options.format === "jpeg" && options.jpegExtent !== undefined) {
            let low = 1, high = Math.floor(quality), best = 1;
            while (low <= high) {
                const trial = quality;
                let size = 0;
                for await (const chunk of encodeStoredRaster(image, storage, signal, { ...options, format: "jpeg", quality: trial, chromaSubsampling: trial < 90 ? "4:2:0" : "4:4:4", synthesizeExif: false })) size += chunk.length;
                if (size <= options.jpegExtent) { best = trial; low = trial + 1; }
                else high = trial - 1;
                quality = Math.floor((low + high) / 2);
            }
            quality = best;
        }
        return yield* encodeStoredRaster(image, storage, signal, { ...options, format: options.format, ...(options.format === "jpeg" && options.jpegExtent !== undefined ? { quality, chromaSubsampling: quality < 90 ? "4:2:0" : "4:4:4" } : {}), synthesizeExif: false });
    }
    let size = 0, channels = 0;
    for (let pixel = 0; pixel < image.width * image.height; pixel += 4096) {
        await yieldTurn(signal);
        const count = Math.min(4096, image.width * image.height - pixel);
        const data = new Uint8Array(await storage.read(image.position + pixel * 4, count * 4, { signal }));
        if (data.length !== count * 4) throw new Error("Truncated raw pixel storage");
        let data16: Uint16Array | undefined;
        if (image.storedData16) {
            const bytes = await storage.read(image.storedData16.position + pixel * 8, count * 8, { signal });
            if (bytes.length !== count * 8) throw new Error("Truncated raw sample storage");
            data16 = new Uint16Array(new Uint8Array(bytes).buffer);
        }
        const encoded = encodeImage({ ...image, width: count, height: 1, data, ...(data16 ? { data16 } : {}) }, options);
        size += encoded.data.length; channels = encoded.channels;
        yield encoded.data;
    }
    return { format: "raw", width: image.width, height: image.height, channels, premultiplied: false, size };
}
