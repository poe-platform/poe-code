type CubeRequest = { kind: "allocate"; tableSize: number; imageSize: number }
    | { kind: "read"; table: boolean; position: number; length: number }
    | { kind: "write"; position: number; data: Uint8Array }
    | Uint8Array;

// Decode the text table into caller backing, then emit a floating-point MIFF Hald.
// The native CUBE reader uses a level-8 Hald and interpolates each channel along
// its own axis, with red varying fastest in the input table.
export function* cubeInput(size: number): Generator<CubeRequest, void, Uint8Array> {
    const header = new TextEncoder().encode("id=ImageMagick class=DirectClass colorspace=sRGB matte=False columns=512 rows=512 depth=32 endian=MSB quantum:format=floating-point\n:\x1a");
    let level = 0, pixel = 0, line = "", used = 0;
    const chunk = new Uint8Array(8190 * 4), samples = new DataView(chunk.buffer);
    for (let position = 0; position <= size; position += 8192) {
        const length = Math.min(8192, size - position);
        const bytes = length ? yield { kind: "read", table: false, position, length } : new Uint8Array();
        if (bytes.length !== length) throw new Error("truncated CUBE input");
        for (let index = 0; index < bytes.length + (position + length === size ? 1 : 0); index++) {
            const byte = bytes[index] ?? 10;
            if (byte !== 10) {
                if (line.length >= 4096) throw new Error("CUBE line exceeds limit");
                line += String.fromCharCode(byte);
                continue;
            }
            const fields = line.split("#", 1)[0]!.trim().replaceAll("\t", " ").split(" ").filter(Boolean);
            line = "";
            if (!fields.length) continue;
            if (fields[0] === "TITLE") continue;
            if (fields[0] === "LUT_3D_SIZE") {
                if (level || fields.length !== 2) throw new Error("invalid CUBE header");
                level = Number(fields[1]);
                if (!Number.isInteger(level) || level < 2 || level > 256) throw new Error("invalid CUBE table size");
                if (level ** 3 * 5 > size) throw new Error("truncated CUBE lookup table");
                yield { kind: "allocate", tableSize: level ** 3 * 12, imageSize: header.length + 512 * 512 * 12 };
                continue;
            }
            if (!level) throw new Error("missing CUBE LUT_3D_SIZE");
            const values = fields.map(Number);
            if (values.length !== 3 || values.some(value => !Number.isFinite(Math.fround(value))) || pixel >= level ** 3) throw new Error("invalid CUBE lookup row");
            for (const value of values) { samples.setFloat32(used, value, true); used += 4; }
            pixel++;
            if (used === chunk.length) {
                yield { kind: "write", position: pixel * 12 - used, data: chunk };
                used = 0;
            }
        }
    }
    if (!level || pixel !== level ** 3) throw new Error("truncated CUBE lookup table");
    if (used) yield { kind: "write", position: pixel * 12 - used, data: chunk.subarray(0, used) };
    yield header;
    // Cache a few input spans; lookup size never determines resident memory.
    const cache = new Map<number, DataView>();
    function* sample(pixel: number, channel: number): Generator<CubeRequest, number, Uint8Array> {
        const offset = pixel * 12 + channel * 4, start = Math.floor(offset / 8192) * 8192;
        let data = cache.get(start);
        if (!data) {
            const bytes = yield { kind: "read", table: true, position: start, length: Math.min(8192, level ** 3 * 12 - start) };
            data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            if (cache.size === 8) cache.delete(cache.keys().next().value!);
            cache.set(start, data);
        }
        return data.getFloat32(offset - start, true);
    }
    for (let start = 0; start < 512 * 512; start += 1024) {
        const output = new Uint8Array(1024 * 12), view = new DataView(output.buffer);
        for (let index = 0; index < 1024; index++) {
            const pixel = start + index;
            const coordinates = [pixel % 64, Math.floor(pixel / 64) % 64, Math.floor(pixel / 4096)]
                .map(value => Math.fround(value / 63 * (level - 1)));
            const [r, g, b] = coordinates.map(Math.floor) as [number, number, number];
            const base = b * level * level + g * level + r;
            for (let channel = 0; channel < 3; channel++) {
                const coordinate = coordinates[channel]!, lower = Math.floor(coordinate);
                const next = base + (lower === level - 1 ? 0 : level ** channel);
                const a = yield* sample(base, channel), z = yield* sample(next, channel);
                const value = Math.fround(a + Math.fround((coordinate - lower) * Math.fround(z - a)));
                view.setFloat32((index * 3 + channel) * 4, value);
            }
        }
        yield output;
    }
}
