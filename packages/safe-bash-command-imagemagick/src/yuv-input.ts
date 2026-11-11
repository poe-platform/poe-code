import { resizeContributions } from "./resize-kernel.js";

// Expose sampled YCbCr as floating-point MIFF so both readers retain chroma precision.
export function yuvRasterInput(width: number, height: number, depth: number, byteLength: number, samplingFactor = "2x2", offset = 0, interlace = "none") {
    const factors = samplingFactor.toLowerCase().split("x").map(Number);
    const horizontal = factors[0]!, vertical = factors[1] ?? horizontal;
    if (factors.length > 2 || horizontal !== 2 || ![1, 2].includes(vertical)) throw new Error("Unexpected sampling factor for YUV input");
    if (interlace === "partition") throw new Error("Partition interlace is not supported for YUV input");
    const sampleBytes = depth <= 8 ? 1 : 2, maximum = sampleBytes === 1 ? 255 : 65535;
    const packed = interlace === "none" && vertical === 1;
    const chromaWidth = Math.ceil(width / horizontal), chromaHeight = Math.ceil(height / vertical);
    const frameLength = (packed ? width * height * 2 : width * height + 2 * chromaWidth * chromaHeight) * sampleBytes;
    const rasterLength = width * height * 12;
    if (!Number.isSafeInteger(rasterLength) || rasterLength <= 0 || !Number.isSafeInteger(frameLength) || !Number.isSafeInteger(offset) || offset < 0 || byteLength - offset < frameLength || (byteLength - offset) % frameLength !== 0) throw new Error("unexpected end-of-file in YUV input");
    const header = new TextEncoder().encode(`id=ImageMagick class=DirectClass colorspace=YCbCr columns=${width} rows=${height} depth=32 quantum:format=floating-point\n:\x1a`);
    return {
        size: header.length + rasterLength,
        pages: (byteLength - offset) / frameLength,
        *read(position: number, size: number, page = 0): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            const start = Math.max(0, position - header.length), end = start + size - headerLength;
            const frameOffset = offset + page * frameLength;
            for (let pixel = Math.floor(start / 12); pixel < Math.ceil(end / 12);) {
                const y = Math.floor(pixel / width), left = pixel % width;
                const count = Math.min(256, width - left, Math.ceil(end / 12) - pixel);
                const samples = new Float64Array(count * 3);
                const firstPair = Math.floor(left / 2), lastPair = Math.ceil((left + count) / 2);
                const lumaStart = packed ? (y * width * 2 + firstPair * 4) * sampleBytes : pixel * sampleBytes;
                const lumaLength = packed ? (lastPair - firstPair) * 4 * sampleBytes : count * sampleBytes;
                const luma = yield { channel: 0, position: frameOffset + lumaStart, length: lumaLength };
                if (luma.length !== lumaLength) throw new Error("unexpected end-of-file in YUV input");
                const lumaView = new DataView(luma.buffer, luma.byteOffset, luma.byteLength);
                for (let x = 0; x < count; x++) {
                    const source = packed ? (Math.floor((left + x) / 2) - firstPair) * 4 + 1 + (left + x) % 2 * 2 : x;
                    samples[x * 3] = sampleBytes === 1 ? luma[source]! : lumaView.getUint16(source * 2);
                }
                const columns = Array.from({ length: count }, (_, x) => resizeContributions(left + x, chromaWidth, width, 1, false, "bilinear"));
                const rows = resizeContributions(y, chromaHeight, height, 1, false, "bilinear");
                const first = columns[0]!.first, last = columns[count - 1]!;
                const span = last.first + last.weights.length - first;
                for (let row = 0; row < rows.weights.length; row++) {
                    for (let channel = 1; channel <= 2; channel++) {
                        const source = packed ? ((rows.first + row) * width * 2 + first * 4) : width * height + (channel - 1) * chromaWidth * chromaHeight + (rows.first + row) * chromaWidth + first;
                        const length = span * sampleBytes * (packed ? 4 : 1);
                        const input = yield { channel: 0, position: frameOffset + source * sampleBytes, length };
                        if (input.length !== length) throw new Error("unexpected end-of-file in YUV input");
                        const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
                        for (let x = 0; x < count; x++) {
                            const column = columns[x]!;
                            let value = 0;
                            for (let tap = 0; tap < column.weights.length; tap++) {
                                const index = packed ? (column.first + tap - first) * 4 + (channel - 1) * 2 : column.first + tap - first;
                                value += (sampleBytes === 1 ? input[index]! : view.getUint16(index * 2)) * column.weights[tap]!;
                            }
                            samples[x * 3 + channel]! += Math.fround(value * 65535 / maximum) * rows.weights[row]!;
                        }
                    }
                }
                const output = new Uint8Array(count * 12), view = new DataView(output.buffer);
                for (let x = 0; x < count; x++) for (let channel = 0; channel < 3; channel++) {
                    view.setFloat32((x * 3 + channel) * 4, channel === 0 ? samples[x * 3]! / maximum : Math.fround(samples[x * 3 + channel]!) / 65535);
                }
                const from = Math.max(start, pixel * 12), to = Math.min(end, (pixel + count) * 12);
                bytes.set(output.subarray(from - pixel * 12, to - pixel * 12), headerLength + from - start);
                pixel += count;
            }
            return bytes;
        }
    };
}
