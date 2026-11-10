// Present headerless RGB/GRAY/GRAYA as Netpbm so both decoding paths retain 16-bit samples.
export function rawNetpbmInput(width: number, height: number, depth: number, endian: string, byteLength: number, channels: 1 | 2 | 3, offset = 0, interlace: "none" | "plane" | "line" | "partition" = "none") {
    const coder = channels === 1 ? "GRAY" : channels === 2 ? "GRAYA" : "RGB";
    if (depth !== 8 && depth !== 16) throw new Error(`unsupported ${coder} input depth '${depth}'`);
    const frameLength = width * height * channels * (depth / 8);
    if (!Number.isSafeInteger(frameLength) || frameLength > byteLength - offset || !Number.isSafeInteger(offset) || offset < 0) throw new Error(`unexpected end-of-file in ${coder} input`);
    // A complete packed scanline starts another frame; a shorter tail is ignored.
    if (interlace === "none" && (byteLength - offset) % frameLength >= frameLength / height) throw new Error(`unexpected end-of-file in ${coder} input`);
    const header = new TextEncoder().encode(channels === 2
        ? `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 2\nMAXVAL ${depth === 8 ? 255 : 65535}\nTUPLTYPE GRAYSCALE_ALPHA\nENDHDR\n`
        : `P${channels === 1 ? 5 : 6}\n${width} ${height}\n${depth === 8 ? 255 : 65535}\n`);
    const swap = depth === 16 && endian !== "msb";
    return {
        size: header.length + frameLength,
        pages: Math.floor((byteLength - offset) / frameLength),
        *read(position: number, size: number, page = 0): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            if (headerLength < size) {
                const start = Math.max(0, position - header.length), end = start + size - headerLength;
                if (interlace !== "none" && channels === 3) {
                    const sampleBytes = depth / 8, pixelBytes = channels * sampleBytes;
                    const lastPixel = Math.ceil(end / pixelBytes);
                    for (let pixel = Math.floor(start / pixelBytes); pixel < lastPixel;) {
                        const row = Math.floor(pixel / width);
                        const limit = Math.min(lastPixel, pixel + 8192 / sampleBytes, interlace === "line" ? (row + 1) * width : lastPixel);
                        const length = (limit - pixel) * sampleBytes;
                        for (let channel = 0; channel < channels; channel++) {
                            const source = interlace === "partition" ? pixel : interlace === "plane" ? channel * width * height + pixel : (row * channels + channel) * width + pixel % width;
                            const input = yield { channel: interlace === "partition" ? channel : 0, position: offset + page * frameLength / (interlace === "partition" ? channels : 1) + source * sampleBytes, length };
                            if (input.length !== length) throw new Error(`unexpected end-of-file in ${coder} input`);
                            for (let i = 0; i < length; i++) {
                                const output = (pixel + Math.floor(i / sampleBytes)) * pixelBytes + channel * sampleBytes + i % sampleBytes;
                                if (output >= start && output < end) bytes[headerLength + output - start] = input[swap ? i ^ 1 : i]!;
                            }
                        }
                        pixel = limit;
                    }
                    return bytes;
                }
                const alignedStart = swap ? start - start % 2 : start;
                const alignedEnd = swap ? end + end % 2 : end;
                for (let cursor = alignedStart; cursor < alignedEnd; cursor += 8192) {
                    const length = Math.min(8192, alignedEnd - cursor);
                    const input = yield { channel: 0, position: offset + page * frameLength + cursor, length };
                    if (input.length !== length) throw new Error(`unexpected end-of-file in ${coder} input`);
                    for (let i = Math.max(start, cursor); i < Math.min(end, cursor + length); i++) {
                        bytes[headerLength + i - start] = input[(swap ? i ^ 1 : i) - cursor]!;
                    }
                }
            }
            return bytes;
        }
    };
}

export function rgbPartitionPaths(path: string): string[] {
    const dot = path.lastIndexOf("."), slash = path.lastIndexOf("/");
    const stem = dot > slash ? path.slice(0, dot) : path;
    return [..."RGB"].map(channel => `${stem}.${channel}`);
}
