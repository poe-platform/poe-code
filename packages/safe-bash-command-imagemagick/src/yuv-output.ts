import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { resizeContributions } from "./resize-kernel.js";
import { convertHuePixels } from "./colorspace-hue.js";
import type { OutputEncodeOptions } from "./raw-output.js";

type Read = { position: number; length: number };
type Image = Pick<RgbaImage, "width" | "height" | "hasAlpha" | "depth" | "bitsPerSample" | "density">;

/** Resize RGB before converting chroma, as the native YUV writer does. */
function* samples(image: Image, width: number, height: number, y: number, left: number, count: number): Generator<Read, Float64Array, Float64Array> {
    const horizontal = Array.from({ length: count }, (_, x) => resizeContributions(left + x, image.width, width, 1, false, "bilinear"));
    const vertical = resizeContributions(y, image.height, height, 1, false, "bilinear");
    const output = new Float64Array(count * 4);
    for (let row = 0; row < vertical.weights.length; row++) {
        const first = horizontal[0]!.first, last = horizontal[count - 1]!;
        const values = yield { position: ((vertical.first + row) * image.width + first) * 4, length: (last.first + last.weights.length - first) * 4 };
        for (let x = 0; x < count; x++) {
            const contribution = horizontal[x]!, pixel = new Float64Array(4);
            for (let tap = 0; tap < contribution.weights.length; tap++) {
                const offset = (contribution.first + tap - first) * 4;
                const alpha = image.hasAlpha ? values[offset + 3]! / 255 : 1;
                for (let c = 0; c < 3; c++) pixel[c]! += values[offset + c]! * alpha * contribution.weights[tap]!;
                pixel[3]! += alpha * contribution.weights[tap]!;
            }
            for (let c = 0; c < 4; c++) output[x * 4 + c]! += pixel[c]! * vertical.weights[row]!;
        }
    }
    for (let x = 0; x < count; x++) {
        const alpha = output[x * 4 + 3]!;
        for (let c = 0; c < 3; c++) output[x * 4 + c] = Math.fround((image.hasAlpha ? Math.abs(alpha) < 1e-12 ? 0 : output[x * 4 + c]! / alpha : output[x * 4 + c]!) * 257) / 257;
        output[x * 4 + 3] = alpha * 255;
    }
    const conversion = convertHuePixels({ ...image, width: count, height: 1, data: new Uint8Array(count * 4), evaluateSamples: output, format: "raw", space: "srgb", channels: 4 }, "YCbCr");
    let next = conversion.next();
    while (!next.done) next = conversion.next();
    return next.value.hueSamples!;
}

function* yuvChunks(image: Image, options: OutputEncodeOptions): Generator<Read | Uint8Array, void, Float64Array> {
    const factors = (options.samplingFactor ?? "2x2").toLowerCase().split("x").map(Number);
    const horizontal = factors[0]!, vertical = factors[1] ?? horizontal;
    if (factors.length > 2 || ![1, 2].includes(horizontal) || ![1, 2].includes(vertical)) throw new Error("Unexpected sampling factor for YUV output");
    if (options.rawInterlace === "partition") throw new Error("Partition interlace is not supported for YUV output");
    const width = image.width + image.width % horizontal, height = image.height + image.height % vertical;
    const chromaWidth = width / horizontal, chromaHeight = height / vertical;
    const bytes = (options.netpbmDepth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8)) <= 8 ? 1 : 2;
    const packed = !options.rawInterlace && vertical === 1;
    for (let plane = 0; plane < (packed ? 1 : 3); plane++) {
        const columns = plane === 0 ? width : chromaWidth, rows = plane === 0 ? height : chromaHeight;
        for (let y = 0; y < rows; y++) for (let left = 0; left < columns; left += 128) {
            const count = Math.min(128, columns - left);
            if (packed && count < 2) continue;
            const pixels = yield* samples(image, columns, rows, y, left, count);
            const chroma = packed ? yield* samples(image, chromaWidth, chromaHeight, y, left / 2, Math.floor(count / 2)) : undefined;
            const output = new Uint8Array(packed ? Math.floor(count / 2) * (2 + 2 * bytes) : count * bytes);
            const view = new DataView(output.buffer);
            let offset = 0;
            const write = (value: number, size: number) => {
                const quantum = Math.max(0, Math.min(65535, Math.fround(value * 65535)));
                if (size === 1) output[offset] = Math.round(quantum / 257);
                else view.setUint16(offset, Math.round(quantum));
                offset += size;
            };
            if (chroma) for (let x = 0; x + 1 < count; x += 2) {
                // Native packed 16-bit YUV still writes chroma as single bytes.
                write(chroma[x * 2 + 1]!, 1); write(pixels[x * 4]!, bytes);
                write(chroma[x * 2 + 2]!, 1); write(pixels[(x + 1) * 4]!, bytes);
            }
            else for (let x = 0; x < count; x++) write(pixels[x * 4 + plane]!, bytes);
            yield output;
        }
    }
}

export function encodeYuvImage(image: RgbaImage, options: OutputEncodeOptions): Uint8Array {
    const steps = yuvChunks(image, options), chunks: Uint8Array[] = [];
    let next = steps.next();
    while (!next.done) {
        if (next.value instanceof Uint8Array) { chunks.push(next.value); next = steps.next(); }
        else {
            const { position, length } = next.value;
            const values = image.evaluateSamples ?? image.data16 ?? image.data;
            const scale = image.evaluateSamples || !image.data16 ? 1 : 1 / 257;
            next = steps.next(Float64Array.from(values.subarray(position, position + length), value => value * scale));
        }
    }
    const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
}

export async function* encodeYuvFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, options: OutputEncodeOptions): AsyncGenerator<Uint8Array> {
    const steps = yuvChunks(image, options);
    let next = steps.next();
    while (!next.done) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        if (next.value instanceof Uint8Array) { yield next.value; next = steps.next(); }
        else {
            const { position, length } = next.value;
            const size = image.storedEvaluateSamples !== undefined ? 8 : image.storedData16 ? 2 : 1;
            const start = image.storedEvaluateSamples ?? image.storedData16?.position ?? image.position;
            const data = await storage.read(start + position * size, length * size, { signal });
            if (data.length !== length * size) throw new Error("Truncated YUV pixel storage");
            const values = size === 8 ? new Float64Array(data.slice().buffer) : size === 2 ? new Uint16Array(data.slice().buffer) : data;
            next = steps.next(Float64Array.from(values, value => size === 2 ? value / 257 : value));
        }
    }
}
