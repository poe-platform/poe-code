// Present headerless samples as Netpbm or MIFF for both decoding paths.
export function rawRasterInput(width: number, height: number, depth: number, endian: string, byteLength: number, layout: 1 | 2 | 3 | 4 | 5 | "rgba" | "rgbo", offset = 0, interlace: "none" | "plane" | "line" | "partition" = "none") {
    const channels = typeof layout === "string" ? 4 : layout;
    const coder = typeof layout === "string" ? layout.toUpperCase() : channels === 1 ? "GRAY" : channels === 2 ? "GRAYA" : channels === 3 ? "RGB" : channels === 4 ? "CMYK" : "CMYKA";
    const packed = (depth === 10 || depth === 12) && (channels === 1 || channels === 3);
    if (!packed && depth !== 8 && depth !== 16 && (depth !== 32 || channels === 2 || typeof layout === "string") && !((depth === 1 || depth === 2 || depth === 4) && (channels === 1 || channels === 3) && interlace === "none")) throw new Error(`unsupported ${coder} input depth '${depth}'`);
    const rowChannels = packed && interlace !== "none" ? 1 : channels;
    const rowSamples = width * channels, rowLength = Math.ceil(width * rowChannels * depth / 8);
    const frameLength = rowLength * height * (channels / rowChannels), decodedLength = rowSamples * height * Math.ceil(Math.min(depth, 16) / 8);
    if (!Number.isSafeInteger(decodedLength) || !Number.isSafeInteger(frameLength) || frameLength > byteLength - offset || !Number.isSafeInteger(offset) || offset < 0) throw new Error(`unexpected end-of-file in ${coder} input`);
    // A complete packed scanline starts another frame; a shorter tail is ignored.
    if (interlace === "none" && (byteLength - offset) % frameLength >= frameLength / height) throw new Error(`unexpected end-of-file in ${coder} input`);
    const header = new TextEncoder().encode(typeof layout !== "string" && channels >= 4
        ? `id=ImageMagick class=DirectClass colorspace=CMYK matte=${channels === 5 ? "True" : "False"} columns=${width} rows=${height} depth=${Math.min(16, depth)}\n:\x1a`
        : channels === 2 || channels === 4
        ? `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH ${channels}\nMAXVAL ${depth <= 8 ? 255 : 65535}\nTUPLTYPE ${channels === 2 ? "GRAYSCALE_ALPHA" : "RGB_ALPHA"}\nENDHDR\n`
        : `P${channels === 1 ? 5 : 6}\n${width} ${height}\n${depth <= 8 ? 255 : 65535}\n`);
    const swap = depth === 16 && endian !== "msb";
    return {
        size: header.length + decodedLength,
        pages: Math.floor((byteLength - offset) / frameLength),
        *read(position: number, size: number, page = 0): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            if (headerLength < size) {
                const start = Math.max(0, position - header.length), end = start + size - headerLength;
                if (depth < 8) {
                    const samplesPerByte = 8 / depth, mask = (1 << depth) - 1;
                    for (let cursor = start; cursor < end;) {
                        const row = Math.floor(cursor / rowSamples), sample = cursor % rowSamples;
                        const firstByte = Math.floor(sample / samplesPerByte);
                        const limit = Math.min(end, (row + 1) * rowSamples, row * rowSamples + (firstByte + 8192) * samplesPerByte);
                        const length = Math.ceil((limit - row * rowSamples) / samplesPerByte) - firstByte;
                        const input = yield { channel: 0, position: offset + page * frameLength + row * rowLength + firstByte, length };
                        if (input.length !== length) throw new Error(`unexpected end-of-file in ${coder} input`);
                        for (; cursor < limit; cursor++) {
                            const index = cursor % rowSamples;
                            const inputSampleBytes = depth / 8;
    const packed = input[Math.floor(index / samplesPerByte) - firstByte]!;
                            bytes[headerLength + cursor - start] = ((packed >> (8 - depth - index % samplesPerByte * depth)) & mask) * (255 / mask);
                        }
                    }
                    return bytes;
                }
                if (packed) {
                    // Packed samples are MSB-first, regardless of -endian; padding ends each channel row.
                    const lastPixel = Math.ceil(end / (channels * 2));
                    for (let pixel = Math.floor(start / (channels * 2)); pixel < lastPixel;) {
                        const row = Math.floor(pixel / width);
                        const limit = Math.min(lastPixel, pixel + 1024, (row + 1) * width);
                        const firstSample = (pixel % width) * rowChannels;
                        const count = (limit - pixel) * rowChannels;
                        const firstByte = Math.floor(firstSample * depth / 8);
                        const length = Math.ceil((firstSample + count) * depth / 8) - firstByte;
                        for (let channel = 0; channel < channels / rowChannels; channel++) {
                            const sourceRow = interlace === "plane" ? channel * height + row : interlace === "line" ? row * channels + channel : row;
                            const input = yield { channel: interlace === "partition" ? channel : 0, position: offset + page * frameLength / (interlace === "partition" ? channels : 1) + sourceRow * rowLength + firstByte, length };
                            if (input.length !== length) throw new Error(`unexpected end-of-file in ${coder} input`);
                            for (let i = 0; i < count; i++) {
                                const bit = (firstSample + i) * depth - firstByte * 8, byte = Math.floor(bit / 8);
                                const sample = ((input[byte]! << 16 | (input[byte + 1] ?? 0) << 8 | (input[byte + 2] ?? 0)) >>> (24 - depth - bit % 8)) & (2 ** depth - 1);
                                const value = Math.round(sample * 65535 / (2 ** depth - 1));
                                const output = (interlace === "none" ? pixel * channels + i : (pixel + i) * channels + channel) * 2;
                                if (output >= start && output < end) bytes[headerLength + output - start] = value >>> 8;
                                if (output + 1 >= start && output + 1 < end) bytes[headerLength + output + 1 - start] = value & 255;
                            }
                        }
                        pixel = limit;
                    }
                    return bytes;
                }
                if (interlace !== "none" && channels === 3) {
                    const sampleBytes = Math.min(depth, 16) / 8, inputSampleBytes = depth / 8, pixelBytes = channels * sampleBytes;
                    const lastPixel = Math.ceil(end / pixelBytes);
                    for (let pixel = Math.floor(start / pixelBytes); pixel < lastPixel;) {
                        const row = Math.floor(pixel / width);
                        const limit = Math.min(lastPixel, pixel + 8192 / inputSampleBytes, interlace === "line" ? (row + 1) * width : lastPixel);
                        const length = (limit - pixel) * sampleBytes;
                        for (let channel = 0; channel < channels; channel++) {
                            const source = interlace === "partition" ? pixel : interlace === "plane" ? channel * width * height + pixel : (row * channels + channel) * width + pixel % width;
                            let input = yield { channel: interlace === "partition" ? channel : 0, position: offset + page * frameLength / (interlace === "partition" ? channels : 1) + source * inputSampleBytes, length: length * inputSampleBytes / sampleBytes };
                            if (input.length !== length * inputSampleBytes / sampleBytes) throw new Error(`unexpected end-of-file in ${coder} input`);
                            if (depth === 32) input = unsigned32To16(input, endian);
                            for (let i = 0; i < length; i++) {
                                const output = (pixel + Math.floor(i / sampleBytes)) * pixelBytes + channel * sampleBytes + i % sampleBytes;
                                if (output >= start && output < end) bytes[headerLength + output - start] = input[swap ? i ^ 1 : i]!;
                            }
                        }
                        pixel = limit;
                    }
                    return bytes;
                }
                const alignedStart = swap || depth === 32 ? start - start % 2 : start;
                const alignedEnd = swap || depth === 32 ? end + end % 2 : end;
                for (let cursor = alignedStart; cursor < alignedEnd; cursor += depth === 32 ? 4096 : 8192) {
                    const length = Math.min(depth === 32 ? 4096 : 8192, alignedEnd - cursor);
                    const ratio = depth === 32 ? 2 : 1;
                    let input = yield { channel: 0, position: offset + page * frameLength + cursor * ratio, length: length * ratio };
                    if (input.length !== length * ratio) throw new Error(`unexpected end-of-file in ${coder} input`);
                    if (depth === 32) input = unsigned32To16(input, endian);
                    for (let i = Math.max(start, cursor); i < Math.min(end, cursor + length); i++) {
                        const value = input[(swap ? i ^ 1 : i) - cursor]!;
                        bytes[headerLength + i - start] = layout === "rgbo" && Math.floor(i / (depth / 8)) % channels === 3 ? 255 - value : value;
                    }
                }
            }
            return bytes;
        }
    };
}

export function rgbPartitionPaths(path: string, format = "rgb"): string[] {
    const dot = path.lastIndexOf("."), slash = path.lastIndexOf("/");
    const stem = dot > slash ? path.slice(0, dot) : path;
    return [...(format.endsWith("o") ? format.slice(0, -1) : format).toUpperCase()].map(channel => `${stem}.${channel}`);
}

function unsigned32To16(input: Uint8Array, endian: string): Uint8Array {
    const source = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const bytes = new Uint8Array(input.length / 2), output = new DataView(bytes.buffer);
    for (let offset = 0; offset < input.length; offset += 4) {
        output.setUint16(offset / 2, Math.round(source.getUint32(offset, endian !== "msb") / 65537));
    }
    return bytes;
}
