// Present headerless samples as Netpbm or MIFF for both decoding paths.
export function rawRasterInput(width: number, height: number, depth: number, endian: string, byteLength: number, layout: 1 | 2 | 3 | 4 | 5 | "rgba" | "rgbo" | "bgr" | "bgra" | "bgro", offset = 0, interlace: "none" | "plane" | "line" | "partition" = "none", floatingPoint = false, extract?: { width?: number; height?: number; x: number; y: number }) {
    const channels = typeof layout === "string" ? layout.length : layout;
    const bgr = typeof layout === "string" && layout.startsWith("bgr"), sampleBytes = Math.min(depth, 16) / 8, pixelBytes = channels * sampleBytes;
    const coder = typeof layout === "string" ? layout.toUpperCase() : channels === 1 ? "GRAY" : channels === 2 ? "GRAYA" : channels === 3 ? "RGB" : channels === 4 ? "CMYK" : "CMYKA";
    if (interlace === "line" && layout === 1) throw new Error("ImageDoesNotHaveAnAlphaChannel in GRAY input");
    const packed = depth === 4 && interlace === "none" || (depth === 1 || depth === 2 || depth === 4 || depth === 10 || depth === 12) && (layout === 1 || layout === 3);
    if (floatingPoint ? depth !== 16 && depth !== 32 && depth !== 64 : !packed && depth !== 8 && depth !== 16 && (depth !== 32 || channels === 2 || typeof layout === "string")) throw new Error(`unsupported ${coder} input depth '${depth}'`);
    const rowChannels = packed && interlace !== "none" ? 1 : channels;
    const rowSamples = width * channels, rowLength = Math.ceil(width * rowChannels * depth / 8);
    // Native GRAYA Line reads gray, alpha and two unused channel spans per row.
    const frameLength = rowLength * height * (channels / rowChannels) * (interlace === "line" && layout === 2 ? 2 : 1), decodedLength = rowSamples * height * Math.ceil(Math.min(depth, 16) / 8);
    if (!Number.isSafeInteger(decodedLength) || !Number.isSafeInteger(frameLength) || frameLength > byteLength - offset || !Number.isSafeInteger(offset) || offset < 0) throw new Error(`unexpected end-of-file in ${coder} input`);
    // A complete packed scanline starts another frame; a shorter tail is ignored.
    if (interlace === "none" && (byteLength - offset) % frameLength >= frameLength / height) throw new Error(`unexpected end-of-file in ${coder} input`);
    const header = new TextEncoder().encode(typeof layout !== "string" && channels >= 4
        ? `id=ImageMagick class=DirectClass colorspace=CMYK matte=${channels === 5 ? "True" : "False"} columns=${width} rows=${height} depth=${Math.max(8, Math.min(16, depth))}\n:\x1a`
        : channels === 2 || channels === 4
        ? `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH ${channels}\nMAXVAL ${depth <= 8 ? 255 : 65535}\nTUPLTYPE ${channels === 2 ? "GRAYSCALE_ALPHA" : "RGB_ALPHA"}\nENDHDR\n`
        : `P${channels === 1 ? 5 : 6}\n${width} ${height}\n${depth <= 8 ? 255 : 65535}\n`);
    // Explicit Undefined uses MSB order; callers resolve an omitted -endian to LSB.
    const swap = !floatingPoint && depth === 16 && endian === "lsb";
    const raw = {
        size: header.length + decodedLength,
        pages: interlace === "partition" ? 1 : Math.floor((byteLength - offset) / frameLength),
        *read(position: number, size: number, page = 0): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            if (headerLength < size) {
                const start = Math.max(0, position - header.length), end = start + size - headerLength;
                if (packed) {
                    // Packed samples are MSB-first, regardless of -endian; padding ends each channel row.
                    const sampleBytes = depth < 8 ? 1 : 2;
                    const lastPixel = Math.ceil(end / (channels * sampleBytes));
                    for (let pixel = Math.floor(start / (channels * sampleBytes)); pixel < lastPixel;) {
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
                                const sampleChannel = interlace === "none" ? i % channels : channel;
                                let value = Math.round(sample * (sampleBytes === 1 ? 255 : 65535) / (2 ** depth - 1));
                                if ((layout === "bgro" || layout === "rgbo") && sampleChannel === 3) value = 255 - value;
                                const output = ((interlace === "none" ? pixel * channels + i : (pixel + i) * channels + channel) + (bgr && sampleChannel < 3 ? 2 - 2 * sampleChannel : 0)) * sampleBytes;
                                if (output >= start && output < end) bytes[headerLength + output - start] = sampleBytes === 1 ? value : value >>> 8;
                                if (sampleBytes === 2 && output + 1 >= start && output + 1 < end) bytes[headerLength + output + 1 - start] = value & 255;
                            }
                        }
                        pixel = limit;
                    }
                    return bytes;
                }
                if (interlace === "partition" || interlace !== "none" && channels >= 3 || (interlace === "plane" || interlace === "line") && layout === 2) {
                    const sampleBytes = Math.min(depth, 16) / 8, inputSampleBytes = depth / 8, pixelBytes = channels * sampleBytes;
                    const lastPixel = Math.ceil(end / pixelBytes);
                    for (let pixel = Math.floor(start / pixelBytes); pixel < lastPixel;) {
                        const row = Math.floor(pixel / width);
                        const limit = Math.min(lastPixel, pixel + 8192 / inputSampleBytes, interlace === "line" || interlace === "partition" && bgr ? (row + 1) * width : lastPixel);
                        const length = (limit - pixel) * sampleBytes;
                        for (let channel = 0; channel < channels; channel++) {
                            // Native BGR partition reads copy the canvas red (zero) and its final blue row.
                            const source = interlace === "partition" ? bgr && channel === 2 ? (height - 1) * width + pixel % width : pixel : interlace === "plane" ? channel * width * height + pixel : (row * (layout === 2 ? 4 : channels) + channel) * width + pixel % width;
                            const sourceChannel = bgr && channel < 3 ? 2 - channel : channel;
                            let input = yield { channel: interlace === "partition" ? sourceChannel : 0, position: offset + page * frameLength / (interlace === "partition" ? channels : 1) + source * inputSampleBytes, length: length * inputSampleBytes / sampleBytes };
                            if (input.length !== length * inputSampleBytes / sampleBytes) throw new Error(`unexpected end-of-file in ${coder} input`);
                            if (floatingPoint || depth === 32) input = rawSamplesTo16(input, depth, endian, floatingPoint);
                            // Native imports .A into a color channel, leaving partition alpha zero.
                            const zero = interlace === "partition" && (bgr && channel === 0 || channel === channels - 1 && (layout === 2 || layout === 5 || typeof layout === "string" && channels === 4));
                            for (let i = 0; i < length; i++) {
                                // Native Plane reads RGB order for every coder; only Line swaps BGR.
                                const outputChannel = interlace === "line" && bgr && channel < 3 ? 2 - channel : channel;
                                const output = (pixel + Math.floor(i / sampleBytes)) * pixelBytes + outputChannel * sampleBytes + i % sampleBytes;
                                const value = layout === "rgbo" && interlace === "line" && channel === 3 ? 255 : input[swap ? i ^ 1 : i]!;
                                // Native CMYKA line interlace stores opacity; plane and packed layouts store alpha.
                                if (output >= start && output < end) bytes[headerLength + output - start] = zero ? 0 : layout === 5 && interlace === "line" && channel === 4 ? 255 - value : value;
                            }
                        }
                        pixel = limit;
                    }
                    return bytes;
                }
                const alignment = bgr ? pixelBytes : swap || floatingPoint || depth === 32 ? 2 : 1;
                const alignedStart = start - start % alignment;
                const alignedEnd = Math.ceil(end / alignment) * alignment;
                const ratio = Math.max(1, depth / 16);
                const chunkBytes = Math.floor(8192 / ratio / alignment) * alignment;
                for (let cursor = alignedStart; cursor < alignedEnd; cursor += chunkBytes) {
                    const length = Math.min(chunkBytes, alignedEnd - cursor);
                    let input = yield { channel: 0, position: offset + page * frameLength + cursor * ratio, length: length * ratio };
                    if (input.length !== length * ratio) throw new Error(`unexpected end-of-file in ${coder} input`);
                    if (floatingPoint || depth === 32) input = rawSamplesTo16(input, depth, endian, floatingPoint);
                    for (let i = Math.max(start, cursor); i < Math.min(end, cursor + length); i++) {
                        const channel = Math.floor(i % pixelBytes / sampleBytes);
                        const source = bgr && channel < 3 ? i + (2 - 2 * channel) * sampleBytes : i;
                        const value = input[(swap ? source ^ 1 : source) - cursor]!;
                        bytes[headerLength + i - start] = (layout === "bgro" || layout === "rgbo") && channel === 3 ? 255 - value : value;
                    }
                }
            }
            return bytes;
        }
    };
    if (!extract) return raw;
    const { width: columns, height: rows, x, y } = extract;
    if (!columns || !rows) throw new Error("must specify image size for GRAY input");
    const bytesPerSample = Math.ceil(Math.min(depth, 16) / 8);
    const rasterLength = columns * rows * bytesPerSample;
    if (!Number.isSafeInteger(rasterLength) || rasterLength > 0x7fffffff) throw new Error("GRAY image dimensions exceed resource limits");
    const extractedHeader = new TextEncoder().encode(`P5\n${columns} ${rows}\n${depth <= 8 ? 255 : 65535}\n`);
    return {
        size: extractedHeader.length + rasterLength,
        pages: raw.pages,
        *read(position: number, size: number, page = 0): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, extractedHeader.length - position));
            bytes.set(extractedHeader.subarray(position, position + headerLength));
            // Read only intersecting scanline spans; missing samples stay black.
            for (let cursor = headerLength; cursor < size;) {
                const offset = position + cursor - extractedHeader.length;
                const column = Math.floor(offset / bytesPerSample) % columns;
                const row = Math.floor(offset / bytesPerSample / columns) + y;
                const sourceColumn = column + x;
                let length = Math.min(size - cursor, (columns - column) * bytesPerSample - offset % bytesPerSample);
                if (sourceColumn < 0) length = Math.min(length, -sourceColumn * bytesPerSample - offset % bytesPerSample);
                else if (row >= 0 && row < height && sourceColumn < width) {
                    length = Math.min(length, (width - sourceColumn) * bytesPerSample - offset % bytesPerSample);
                    bytes.set(yield* raw.read(header.length + (row * width + sourceColumn) * bytesPerSample + offset % bytesPerSample, length, page), cursor);
                }
                cursor += length;
            }
            return bytes;
        },
    };
}

export function rawPartitionPaths(path: string, format = "rgb"): string[] {
    const dot = path.lastIndexOf("."), slash = path.lastIndexOf("/");
    const stem = dot > slash ? path.slice(0, dot) : path;
    const channels = format === "gray" ? "G" : format === "graya" ? "GA" : (format.endsWith("o") ? format.slice(0, -1) : format).toUpperCase();
    return [...channels].map(channel => `${stem}.${channel}`);
}

function rawSamplesTo16(input: Uint8Array, depth: number, endian: string, floatingPoint: boolean): Uint8Array {
    const source = new DataView(input.buffer, input.byteOffset, input.byteLength), sampleBytes = depth / 8;
    const bytes = new Uint8Array(input.length / sampleBytes * 2), output = new DataView(bytes.buffer);
    for (let index = 0; index < input.length / sampleBytes; index++) {
        let value: number;
        if (!floatingPoint) value = source.getUint32(index * 4, endian !== "msb") / 4294967295;
        else if (depth === 16) {
            const half = source.getUint16(index * 2, endian !== "msb"), exponent = (half >>> 10) & 31, fraction = half & 1023;
            value = exponent === 0 ? fraction * 2 ** -24 : exponent === 31 ? fraction ? NaN : Infinity : (1 + fraction / 1024) * 2 ** (exponent - 15);
            if (half & 0x8000) value = -value;
        } else value = depth === 32 ? source.getFloat32(index * 4, endian !== "msb") : source.getFloat64(index * 8, endian !== "msb");
        output.setUint16(index * 2, Number.isNaN(value) ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 65535));
    }
    return bytes;
}
