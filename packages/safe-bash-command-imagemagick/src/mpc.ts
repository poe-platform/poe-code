import { type RgbaImage, type StoredRgbaImage, type ImageByteSource, type ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

// ImageMagick 7 Q16-HDRI: native little-endian float quanta, range 0..65535.
const signature = 762599890;
export function mpcCachePath(path: string): string {
    const dot = path.lastIndexOf(".");
    return `${dot > path.lastIndexOf("/") ? path.slice(0, dot) : path}.cache`;
}
export function storeMpc(files: Map<string, Uint8Array>, path: string, bytes: Uint8Array): void {
    const end = bytes.indexOf(26) + 1;
    files.set(mpcCachePath(path), bytes.slice(end));
    files.set(path, bytes.slice(0, end));
}
export function isMpc(bytes: Uint8Array): boolean {
    return new TextDecoder().decode(bytes.subarray(0, 20)) === "id=MagickPixelCache\n";
}
export function mpcHeader(image: RgbaImage | StoredRgbaImage): Uint8Array {
    const page = image.virtualCanvas;
    let header = `id=MagickPixelCache\nmagick-signature=${signature}\nclass=DirectClass colors=0 alpha-trait=${image.hasAlpha ? "Blend" : "Undefined"}\nnumber-channels=${image.hasAlpha ? 4 : 3} number-meta-channels=0 channel-mask=0x0000000007ffffff\ncolumns=${image.width} rows=${image.height} depth=16\ncolorspace=sRGB\n`;
    if (page) header += `page=${page.width}x${page.height}${page.x < 0 ? "" : "+"}${page.x}${page.y < 0 ? "" : "+"}${page.y}\n`;
    for (const [key, value] of Object.entries(image.properties ?? {})) {
        if (key.startsWith("artifact:") || key.includes("=") || [...key].some(c => c.trim() === "")) continue;
        const escaped = value.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
        header += `${key}=${[...value].some(c => c.trim() === "" || c === "{" || c === "}") ? `{${escaped}}` : escaped}\n`;
    }
    return new TextEncoder().encode(`${header}\f\n:\x1a`);
}
export function mpcPixels(image: RgbaImage): Uint8Array {
    const channels = image.hasAlpha ? 4 : 3, pixels = image.width * image.height;
    const bytes = new Uint8Array(pixels * channels * 4), view = new DataView(bytes.buffer);
    for (let pixel = 0; pixel < pixels; pixel++) for (let channel = 0; channel < channels; channel++) {
        const index = pixel * 4 + channel;
        view.setFloat32((pixel * channels + channel) * 4, image.data16?.[index] ?? image.data[index]! * 257, true);
    }
    return bytes;
}
export async function* mpcStoredPixels(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    for (let start = 0; start < image.width * image.height; start += 1024) {
        await yieldTurn(signal);
        const count = Math.min(1024, image.width * image.height - start);
        const data = await storage.read(image.position + start * 4, count * 4, { signal });
        const data16 = image.storedData16 ? new Uint16Array(new Uint8Array(await storage.read(image.storedData16.position + start * 8, count * 8, { signal })).buffer) : undefined;
        yield mpcPixels({ ...image, width: count, height: 1, data, ...(data16 ? { data16 } : {}) });
    }
}
function mpcLayout(descriptor: Uint8Array, cacheSize: number): { header: Uint8Array; samples: number } {
    if (!isMpc(descriptor) || descriptor.at(-1) !== 26 || descriptor.length > 65536) throw new Error("Invalid MPC descriptor");
    const text = new TextDecoder().decode(descriptor), fields = new Map<string, string>();
    let index = 0;
    while (index < text.length) {
        while (index < text.length && text.charCodeAt(index) <= 32) index++;
        const start = index;
        while (index < text.length && text[index] !== "=" && text.charCodeAt(index) > 32) index++;
        const key = text.slice(start, index);
        if (text[index++] !== "=") continue;
        const quote = text[index] === "{" ? "}" : text[index] === '"' || text[index] === "'" ? text[index] : undefined;
        if (quote) index++;
        let value = "";
        while (index < text.length && (quote ? text[index] !== quote : text.charCodeAt(index) > 32)) {
            if (text[index] === "\\" && index + 1 < text.length) index++;
            value += text[index++];
        }
        if (quote) index++;
        fields.set(key, value);
    }
    const alpha = fields.get("alpha-trait") === "Blend", channels = alpha ? 4 : 3;
    if (Number(fields.get("magick-signature")) !== signature || fields.get("class") !== "DirectClass" || Number(fields.get("number-meta-channels")) !== 0 || Number(fields.get("number-channels")) !== channels || fields.get("colorspace") !== "sRGB") throw new Error("Unsupported MPC cache layout (requires ImageMagick 7 Q16-HDRI sRGB)");
    const width = Number(fields.get("columns")), height = Number(fields.get("rows")), samples = width * height * channels;
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(samples * 4) || cacheSize < samples * 4) throw new Error("Truncated MPC pixel cache");
    const header = new TextEncoder().encode(text.replace("id=MagickPixelCache", "id=ImageMagick").replace("\f\n:\x1a", `matte=${alpha ? "True" : "False"}\ndepth=16\ncompression=None\n\f\n:\x1a`));
    return { header, samples };
}
function mpcQuantumBytes(raw: Uint8Array): Uint8Array {
    const input = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), bytes = new Uint8Array(raw.length / 2), output = new DataView(bytes.buffer);
    for (let i = 0; i < raw.length / 4; i++) output.setUint16(i * 2, Math.round(Math.max(0, Math.min(65535, input.getFloat32(i * 4, true)))));
    return bytes;
}
/** Present the separate native cache as a bounded MIFF source for existing decoders. */
export function mpcSource(descriptor: Uint8Array, cache: ImageByteSource): ImageByteSource {
    const { header, samples } = mpcLayout(descriptor, cache.size);
    return { size: header.length + samples * 2, async read(position, count, options) {
        const bytes = new Uint8Array(count);
        const headerCount = Math.max(0, Math.min(count, header.length - position));
        bytes.set(header.subarray(position, position + headerCount));
        if (headerCount < count) {
            const offset = position + headerCount - header.length;
            const first = Math.floor(offset / 2), last = Math.ceil((offset + count - headerCount) / 2);
            const converted = new Uint8Array((last - first) * 2);
            for (let start = first; start < last; start += 4096) converted.set(mpcQuantumBytes(await cache.read(start * 4, Math.min(4096, last - start) * 4, options)), (start - first) * 2);
            bytes.set(converted.subarray(offset % 2, offset % 2 + count - headerCount), headerCount);
        }
        return bytes;
    } };
}
export function mpcToMiff(descriptor: Uint8Array, cache: Uint8Array): Uint8Array {
    const { header, samples } = mpcLayout(descriptor, cache.length);
    const bytes = new Uint8Array(header.length + samples * 2); bytes.set(header);
    bytes.set(mpcQuantumBytes(cache.subarray(0, samples * 4)), header.length);
    return bytes;
}
