// Present the default RGB FTXT records as Q16 PPM to share raster decoding.
export function* ftxtInput(width: number, height: number, size: number): Generator<{ position: number; length: number } | Uint8Array, void, Uint8Array> {
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels * 6) || width < 1 || height < 1 || pixels > size) throw new Error("invalid FTXT image size or truncated input");
    yield new TextEncoder().encode(`P6\n${width} ${height}\n65535\n`);
    let line = "", pixel = 0, used = 0;
    const output = new Uint8Array(8190);
    for (let position = 0; position <= size; position += 8192) {
        const length = Math.min(8192, size - position);
        const bytes = length ? yield { position, length } : new Uint8Array();
        if (bytes.length !== length) throw new Error("truncated FTXT input");
        for (let index = 0; index < bytes.length + (position + length === size ? 1 : 0); index++) {
            const byte = bytes[index] ?? 10;
            if (byte !== 10) {
                if (line.length >= 4096) throw new Error("FTXT line exceeds limit");
                line += String.fromCharCode(byte);
                continue;
            }
            const record = line.trim(); line = "";
            if (!record) continue;
            const colon = record.indexOf(":"), coordinates = record.slice(0, colon).split(",").map(Number);
            const values = record.slice(colon + 1).split(",").map(value => value.trim() ? Number(value) : NaN);
            if (colon < 0 || coordinates.length !== 2 || coordinates[0] !== pixel % width || coordinates[1] !== Math.floor(pixel / width) || pixel >= pixels || values.length !== 3 || values.some(value => !Number.isFinite(value) || value < 0 || value > 65535)) throw new Error("invalid FTXT pixel");
            for (const value of values) { const sample = Math.round(value); output[used++] = sample >>> 8; output[used++] = sample & 255; }
            pixel++;
            if (used === output.length) { yield output; used = 0; }
        }
    }
    if (pixel !== pixels) throw new Error("truncated FTXT pixels");
    if (used) yield output.subarray(0, used);
}
