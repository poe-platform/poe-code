// Present MAP's headerless palette and indices as indexed MIFF for both readers.
export function mapRasterInput(width: number, height: number, depth: number, byteLength: number, colors = 256) {
    colors ||= 256;
    if (depth !== 8 && depth !== 16) throw new Error(`unsupported MAP input depth '${depth}'`);
    if (!Number.isSafeInteger(colors) || colors < 1 || colors > (depth === 8 ? 256 : 65536)) throw new Error("invalid MAP palette size");
    const sampleBytes = depth / 8, paletteLength = colors * 3 * sampleBytes;
    const rowLength = width * sampleBytes, rasterLength = rowLength * height;
    if (!Number.isSafeInteger(rasterLength) || width < 1 || height < 1 || paletteLength + rasterLength > byteLength) throw new Error("unexpected end-of-file in MAP input");
    const header = new TextEncoder().encode(`id=ImageMagick class=PseudoClass colors=${colors} colorspace=sRGB columns=${width} rows=${height} depth=${depth}\n:\x1a`);
    return {
        size: header.length + paletteLength + rasterLength,
        pages: 1,
        *read(position: number, size: number): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            for (let offset = headerLength; offset < size;) {
                const source = position + offset - header.length;
                let length = Math.min(8192, size - offset);
                if (source < paletteLength || depth === 8 || colors > 256) {
                    if (source < paletteLength) length = Math.min(length, paletteLength - source);
                    const input = yield { position: source, length, channel: 0 };
                    if (input.length !== length) throw new Error("unexpected end-of-file in MAP input");
                    bytes.set(input, offset);
                } else {
                    // Native 16-bit MAP with <=256 colors uses the first width
                    // bytes of each double-width row as indices. MIFF uses shorts.
                    const pixel = Math.floor((source - paletteLength) / 2), column = pixel % width;
                    length = Math.min(length, (width - column) * 2 - source % 2);
                    const count = Math.ceil((length + source % 2) / 2);
                    const input = yield { position: paletteLength + Math.floor(pixel / width) * rowLength + column, length: count, channel: 0 };
                    if (input.length !== count) throw new Error("unexpected end-of-file in MAP input");
                    for (let i = 0; i < length; i++) if ((source + i) % 2 === 1) bytes[offset + i] = input[Math.floor((source % 2 + i) / 2)]!;
                }
                offset += length;
            }
            return bytes;
        }
    };
}
