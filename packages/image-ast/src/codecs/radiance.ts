import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";

export function isRadianceBytes(bytes: Uint8Array): boolean {
    const signature = new TextDecoder().decode(bytes.subarray(0, 11));
    return signature.startsWith("#?RADIANCE\n") || signature.startsWith("#?RADIANCE\r") || signature.startsWith("#?RGBE\n") || signature.startsWith("#?RGBE\r");
}

export function* radianceHeader(size: number): Generator<number, { metadata: ImageMetadata & { magickColorspace: "RGB" }; offset: number; axes: string[]; counts: number[] }, number | undefined> {
    let offset = 0;
    function* line(): Generator<number, string, number | undefined> {
        let value = "";
        while (true) {
            const byte = yield offset++;
            if (byte === undefined) throw new Error("Truncated Radiance header");
            if (byte === 10) return value.trim();
            if (value.length >= 4096) throw new Error("Radiance header line too long");
            value += String.fromCharCode(byte);
        }
    }
    const magic = yield* line();
    if (magic !== "#?RADIANCE" && magic !== "#?RGBE") throw new Error("Invalid Radiance signature");
    let format = "", entry: string;
    while ((entry = yield* line()) !== "") if (entry.startsWith("FORMAT=")) format = entry.slice(7);
    if (format !== "32-bit_rle_rgbe") throw new Error("Unsupported Radiance pixel format");
    const parts = (yield* line()).split(" ").flatMap(part => part.split("\t")).filter(Boolean);
    const axes = [parts[0]!, parts[2]!], counts = [Number(parts[1]), Number(parts[3])];
    if (parts.length !== 4 || axes.some(axis => !["+X", "-X", "+Y", "-Y"].includes(axis)) || axes[0]![1] === axes[1]![1] || counts.some(count => !Number.isSafeInteger(count) || count <= 0) || !Number.isSafeInteger(counts[0]! * counts[1]! * 16)) throw new Error("Invalid Radiance dimensions");
    const width = counts[axes[0]![1] === "X" ? 0 : 1]!, height = counts[axes[0]![1] === "Y" ? 0 : 1]!;
    return { metadata: { format: "hdr", width, height, channels: 3, depth: "float", space: "srgb", magickColorspace: "RGB", gamma: 1, hasAlpha: false, density: 72, size }, offset, axes, counts };
}

export function readRadianceHeader(bytes: Uint8Array) {
    const steps = radianceHeader(bytes.length); let next = steps.next();
    while (!next.done) next = steps.next(bytes[next.value]);
    return next.value;
}

type Header = ReturnType<typeof readRadianceHeader>;

// Shared byte parser: buffered and retained inputs use identical RLE validation.
export function* radianceRows(header: Header, options?: SharpInputOptions): Generator<number | { indices: number[]; data: Uint8Array; data16: Uint16Array; dataFloat: Float32Array }, void, number | undefined> {
    // Native ImageMagick accepts Y-first rows followed by positive X, regardless of the Y sign.
    if (options?.hdrPreserveScanlineOrder && (header.axes[0]![1] !== "Y" || header.axes[1] !== "+X"))
        throw new Error("no pixels defined in cache");
    let offset = header.offset;
    function* byte(): Generator<number, number, number | undefined> {
        const value = yield offset++;
        if (value === undefined) throw new Error("Truncated Radiance raster");
        return value;
    }
    const [major, minor] = header.counts as [number, number];
    for (let row = 0; row < major; row++) {
        let planes: Uint8Array | undefined;
        let first: number[] | undefined = [yield* byte(), yield* byte(), yield* byte(), yield* byte()];
        if (minor >= 8 && minor <= 32767 && first[0] === 2 && first[1] === 2 && first[2]! < 128) {
            if (first[2]! * 256 + first[3]! !== minor) throw new Error("Invalid Radiance scanline width");
            planes = new Uint8Array(minor * 4);
            for (let channel = 0; channel < 4; channel++) {
                let x = 0;
                while (x < minor) {
                    const code = yield* byte(), count = code > 128 ? code - 128 : code;
                    if (!count || x + count > minor) throw new Error("Invalid Radiance RLE packet");
                    if (code > 128) planes.fill(yield* byte(), channel * minor + x, channel * minor + x + count);
                    else for (let i = 0; i < count; i++) planes[channel * minor + x + i] = yield* byte();
                    x += count;
                }
            }
            first = undefined;
        }
        for (let start = 0; start < minor; start += 1024) {
            const count = Math.min(1024, minor - start), data = new Uint8Array(count * 4), data16 = new Uint16Array(count * 4), dataFloat = new Float32Array(count * 4), indices: number[] = [];
            for (let i = 0; i < count; i++) {
                const column = start + i;
                let pixel: number[];
                if (planes) pixel = [planes[column]!, planes[minor + column]!, planes[minor * 2 + column]!, planes[minor * 3 + column]!];
                else {
                    // ImageMagick reads every flat RGBE tuple literally, including 01 01 01.
                    pixel = first ?? [yield* byte(), yield* byte(), yield* byte(), yield* byte()];
                    first = undefined;
                }
                const coordinates = [row, column].map((value, axis) => header.axes[axis] === "+X" || header.axes[axis] === "-Y" || (options?.hdrPreserveScanlineOrder && header.axes[axis] === "+Y") ? value : header.counts[axis]! - 1 - value);
                const x = coordinates[header.axes[0]![1] === "X" ? 0 : 1]!, y = coordinates[header.axes[0]![1] === "Y" ? 0 : 1]!;
                indices.push((y * header.metadata.width + x) * 4);
                for (let channel = 0; channel < 4; channel++) {
                    const value = channel === 3 ? 1 : pixel[3] === 0 ? 0 : pixel[channel]! * 2 ** (pixel[3]! - 136);
                    const bounded = Math.min(1, value), index = i * 4 + channel;
                    dataFloat[index] = value;
                    data16[index] = Math.round(bounded * 65535);
                    data[index] = data16[index]! >>> 8;
                }
            }
            yield { indices, data, data16, dataFloat };
        }
    }
}

export function decodeRadianceImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
    const header = readRadianceHeader(bytes), { width, height } = header.metadata;
    checkLimitInputPixels(width, height, options);
    const data = new Uint8Array(width * height * 4), data16 = new Uint16Array(data.length), dataFloat = new Float32Array(data.length);
    const steps = radianceRows(header, options); let next = steps.next();
    while (!next.done) {
        if (typeof next.value === "number") next = steps.next(bytes[next.value]);
        else {
            const row = next.value;
            row.indices.forEach((target, i) => { data.set(row.data.subarray(i * 4, i * 4 + 4), target); data16.set(row.data16.subarray(i * 4, i * 4 + 4), target); dataFloat.set(row.dataFloat.subarray(i * 4, i * 4 + 4), target); });
            next = steps.next();
        }
    }
    return { ...header.metadata, data, data16, dataFloat };
}
