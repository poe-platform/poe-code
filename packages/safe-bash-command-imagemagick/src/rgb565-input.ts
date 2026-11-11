// Expand packed RGB565 words into native Q16 samples, exposed as MIFF.
export function rgb565RasterInput(width: number, height: number, byteLength: number, offset = 0, endian = "lsb", scenes?: number[][]) {
    const frameLength = width * height * 2, rasterLength = frameLength * 3;
    if (!Number.isSafeInteger(rasterLength) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid RGB565 image size");
    const pages = Math.floor((byteLength - offset) / frameLength);
    if (pages < 1 || (byteLength - offset) % frameLength >= width * 2 && (!scenes || scenes.some(range => range.some(page => page < 0 || page >= pages)))) throw new Error("unexpected end-of-file in RGB565 input");
    const header = new TextEncoder().encode(`id=ImageMagick class=DirectClass colorspace=sRGB matte=False columns=${width} rows=${height} depth=16\n:\x1a`);
    return {
        size: header.length + rasterLength,
        pages,
        *read(position: number, size: number, page = 0): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            const start = Math.max(0, position - header.length), end = start + size - headerLength;
            for (let pixel = Math.floor(start / 6); pixel < Math.ceil(end / 6);) {
                const count = Math.min(4096, Math.ceil(end / 6) - pixel);
                const input = yield { position: offset + page * frameLength + pixel * 2, length: count * 2, channel: 0 };
                if (input.length !== count * 2) throw new Error("unexpected end-of-file in RGB565 input");
                const words = new DataView(input.buffer, input.byteOffset, input.byteLength);
                for (let i = 0; i < count; i++) {
                    const word = words.getUint16(i * 2, endian === "lsb");
                    // Native shifts into Q16 without replicating the low bits.
                    for (let channel = 0; channel < 3; channel++) {
                        const value = channel === 0 ? word & 0xf800 : channel === 1 ? (word & 0x07e0) << 5 : (word & 0x001f) << 11;
                        const output = (pixel + i) * 6 + channel * 2;
                        if (output >= start && output < end) bytes[headerLength + output - start] = value >>> 8;
                        if (output + 1 >= start && output + 1 < end) bytes[headerLength + output + 1 - start] = value & 255;
                    }
                }
                pixel += count;
            }
            return bytes;
        }
    };
}
