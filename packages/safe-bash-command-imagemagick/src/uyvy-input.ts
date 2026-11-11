// UYVY and PAL store U, Y1, V, Y2 bytes; expose their YCbCr samples as MIFF.
export function uyvyRasterInput(width: number, height: number, byteLength: number, offset = 0) {
    width += width % 2;
    const rasterLength = width * height * 3;
    if (!Number.isSafeInteger(rasterLength) || width < 1 || height < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid UYVY image size");
    const header = new TextEncoder().encode(`id=ImageMagick class=DirectClass colorspace=YCbCr matte=False columns=${width} rows=${height} depth=8\n:\x1a`);
    return {
        size: header.length + rasterLength,
        pages: 1,
        *read(position: number, size: number): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            for (let cursor = headerLength; cursor < size;) {
                const start = position + cursor - header.length;
                const pair = Math.floor(start / 6);
                const count = Math.min(size - cursor, 6144 - start % 6);
                const source = offset + pair * 4;
                const length = Math.max(0, Math.min(Math.ceil((start % 6 + count) / 6) * 4, byteLength - source));
                const input = length ? yield { position: source, length, channel: 0 } : new Uint8Array();
                for (let i = 0; i < count; i++) {
                    const sample = start % 6 + i;
                    const component = sample % 6;
                    // Native reads a single frame, widens odd rows, and treats EOF as 255.
                    const channel = component === 0 ? 1 : component === 3 ? 3 : component % 3 === 1 ? 0 : 2;
                    bytes[cursor + i] = input[Math.floor(sample / 6) * 4 + channel] ?? 255;
                }
                cursor += count;
            }
            return bytes;
        }
    };
}
