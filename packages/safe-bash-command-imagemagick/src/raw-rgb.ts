// Present headerless RGB as PPM so both decoding paths retain 16-bit samples.
export function rawRgbInput(width: number, height: number, depth: number, endian: string, byteLength: number) {
    if (depth !== 8 && depth !== 16) throw new Error(`unsupported RGB input depth '${depth}'`);
    const length = width * height * 3 * (depth / 8);
    if (!Number.isSafeInteger(length) || length > byteLength) throw new Error("unexpected end-of-file in RGB input");
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n${depth === 8 ? 255 : 65535}\n`);
    const swap = depth === 16 && endian !== "msb";
    return {
        size: header.length + length,
        *read(position: number, size: number): Generator<{ position: number; length: number }, Uint8Array, Uint8Array> {
            const bytes = new Uint8Array(size);
            const headerLength = Math.max(0, Math.min(size, header.length - position));
            bytes.set(header.subarray(position, position + headerLength));
            if (headerLength < size) {
                const start = Math.max(0, position - header.length), end = start + size - headerLength;
                const alignedStart = swap ? start - start % 2 : start;
                const alignedEnd = swap ? end + end % 2 : end;
                for (let offset = alignedStart; offset < alignedEnd; offset += 8192) {
                    const length = Math.min(8192, alignedEnd - offset);
                    const input = yield { position: offset, length };
                    if (input.length !== length) throw new Error("unexpected end-of-file in RGB input");
                    for (let i = Math.max(start, offset); i < Math.min(end, offset + length); i++) {
                        bytes[headerLength + i - start] = input[(swap ? i ^ 1 : i) - offset]!;
                    }
                }
            }
            return bytes;
        }
    };
}
