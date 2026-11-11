// MONO stores one LSB-first bit per pixel, with padding at each row boundary.
// Present it as PBM so both readers preserve its indexed, bilevel Gray metadata.
export function monoRasterInput(width: number, height: number, byteLength: number, offset = 0, endian?: string) {
    const rasterLength = Math.ceil(width / 8) * height;
    if (!Number.isSafeInteger(rasterLength) || width < 1 || height < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid MONO image size");
    const header = new TextEncoder().encode(`P4\n${width} ${height}\n`);
    return {
        size: header.length + rasterLength,
        pages: 1,
        *read(position: number, size: number): Generator<{ position: number; length: number; channel: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            for (let cursor = headerLength; cursor < size;) {
                const source = offset + position + cursor - header.length;
                const count = Math.min(8192, size - cursor);
                const length = Math.max(0, Math.min(count, byteLength - source));
                const input = length ? yield { position: source, length, channel: 0 } : new Uint8Array();
                for (let i = 0; i < count; i++) {
                    // Native treats EOF as all set bits and explicit endian as
                    // reversed polarity (the bit order itself stays LSB-first).
                    let value = input[i] ?? 255;
                    value = (value >>> 4) | ((value & 15) << 4);
                    value = ((value & 204) >>> 2) | ((value & 51) << 2);
                    value = ((value & 170) >>> 1) | ((value & 85) << 1);
                    bytes[cursor + i] = endian === undefined ? value : value ^ 255;
                }
                cursor += count;
            }
            return bytes;
        }
    };
}
