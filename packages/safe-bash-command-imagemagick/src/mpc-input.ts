interface MpcRead { offset: number; length: number; }
interface MpcInput {
    size: number;
    read(position: number, length: number): Generator<MpcRead, Uint8Array, Uint8Array>;
}

export function isMpc(bytes: Uint8Array): boolean {
    return new TextDecoder().decode(bytes.subarray(0, 19)) === "id=MagickPixelCache";
}

export function mpcCachePath(path: string): string {
    const dot = path.lastIndexOf(".");
    return (dot > path.lastIndexOf("/") ? path.slice(0, dot) : path) + ".cache";
}

/** Present native IM7 Q16-HDRI caches as MIFF without retaining pixel data. */
export function* mpcInput(descriptorSize: number, cacheSize: number): Generator<MpcRead, MpcInput, Uint8Array> {
    const segments: { start: number; header: Uint8Array; rasterSize: number; cacheOffset: number }[] = [];
    let offset = 0, cacheOffset = 0, size = 0, blockStart = 0;
    let block: Uint8Array = new Uint8Array();
    function* byte(): Generator<MpcRead, number, Uint8Array> {
        if (offset >= descriptorSize) throw new Error("Truncated MPC descriptor");
        if (offset >= blockStart + block.length) {
            blockStart = offset;
            block = yield { offset, length: Math.min(4096, descriptorSize - offset) };
            if (!block.length) throw new Error("Truncated MPC descriptor");
        }
        return block[offset++ - blockStart]!;
    }
    while (offset < descriptorSize) {
        let text = "", quote = "";
        while (true) {
            const char = String.fromCharCode(yield* byte());
            if (!quote && char === ":") {
                const next = yield* byte();
                if (next === 26) break;
                text += char + String.fromCharCode(next);
            } else {
                if (quote) { if (char === quote) quote = ""; }
                else if (char === "{") quote = "}";
                else if (char === '"' || char === "'") quote = char;
                text += char;
            }
            if (text.length > 65536) throw new Error("MPC header exceeds limit");
        }
        const fields = new Map<string, string>();
        let index = 0;
        while (index < text.length) {
            while (index < text.length && text.charCodeAt(index) <= 32) index++;
            const start = index;
            while (index < text.length && text[index] !== "=" && text.charCodeAt(index) > 32) index++;
            const key = text.slice(start, index);
            if (text[index] !== "=") { if (index === start) index++; continue; }
            index++;
            const delimiter = text[index] === "{" ? "}" : text[index] === '"' || text[index] === "'" ? text[index] : undefined;
            if (delimiter) index++;
            const valueStart = index;
            while (index < text.length && (delimiter ? text[index] !== delimiter : text.charCodeAt(index) > 32)) index++;
            fields.set(key, text.slice(valueStart, index));
            if (delimiter) index++;
        }
        if (fields.get("id") !== "MagickPixelCache") throw new Error("Invalid MPC signature");
        // MPC is a native memory dump. This signature identifies IM7 Q16-HDRI;
        // supported caches use little-endian floats and 4096-byte page alignment.
        if (fields.get("magick-signature") !== "762599890" || fields.get("class") !== "DirectClass"
            || fields.has("profile") || fields.has("montage")
            || Number(fields.get("number-meta-channels") ?? 0) !== 0)
            throw new Error("Unsupported MPC cache encoding");
        const width = Number(fields.get("columns")), height = Number(fields.get("rows"));
        const channels = Number(fields.get("number-channels"));
        const expectedChannels = (fields.get("colorspace") === "Gray" ? 1 : fields.get("colorspace") === "CMYK" ? 4 : 3)
            + Number(fields.get("alpha-trait") === "Blend");
        const rasterSize = width * height * channels * 4;
        if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1
            || channels !== expectedChannels || !Number.isSafeInteger(rasterSize) || !Number.isSafeInteger(size + rasterSize))
            throw new Error("Invalid MPC dimensions or channels");
        if (rasterSize > cacheSize - cacheOffset) throw new Error("Truncated MPC pixel cache");
        fields.delete("magick-signature");
        fields.set("id", "ImageMagick");
        fields.set("depth", "32");
        fields.set("quantum:format", "floating-point");
        fields.set("compression", "None");
        fields.set("endian", "MSB");
        const header = new TextEncoder().encode([...fields].map(([key, value]) => key === "id" ? `${key}=${value}\n` : `${key}={${value}}\n`).join("") + "\f\n:\x1a");
        segments.push({ start: size, header, rasterSize, cacheOffset });
        size += header.length + rasterSize;
        // Native PersistPixelCache advances a full page even for aligned rasters.
        cacheOffset += rasterSize + 4096 - rasterSize % 4096;
    }
    if (!segments.length) throw new Error("Truncated MPC descriptor");
    return { size, *read(position, length) {
        if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > size)
            throw new RangeError("Invalid MPC input range");
        const output = new Uint8Array(length);
        for (const segment of segments) {
            const end = segment.start + segment.header.length + segment.rasterSize;
            if (position >= end || position + length <= segment.start) continue;
            const start = Math.max(position, segment.start), headerEnd = segment.start + segment.header.length;
            if (start < headerEnd) output.set(segment.header.subarray(start - segment.start, Math.min(headerEnd, position + length) - segment.start), start - position);
            const rasterStart = Math.max(position, headerEnd), rasterEnd = Math.min(position + length, end);
            if (rasterStart >= rasterEnd) continue;
            const first = Math.floor((rasterStart - headerEnd) / 4) * 4, last = Math.ceil((rasterEnd - headerEnd) / 4) * 4;
            const bytes = yield { offset: segment.cacheOffset + first, length: last - first };
            if (bytes.length !== last - first) throw new Error("Truncated MPC pixel cache");
            const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), converted = new Uint8Array(bytes.length), view = new DataView(converted.buffer);
            for (let index = 0; index < bytes.length; index += 4) view.setFloat32(index, input.getFloat32(index, true) / 65535);
            output.set(converted.subarray(rasterStart - headerEnd - first, rasterEnd - headerEnd - first), rasterStart - position);
        }
        return output;
    } };
}

export function* readMpc(bytes: Uint8Array, path: string, files: ReadonlyMap<string, Uint8Array>): Generator<void, Uint8Array, void> {
    if (!isMpc(bytes)) return bytes;
    const cachePath = mpcCachePath(path), cache = files.get(cachePath);
    if (!cache) throw new Error(`Missing MPC pixel cache '${cachePath}'`);
    const steps = mpcInput(bytes.length, cache.length);
    let next = steps.next();
    while (!next.done) { yield; next = steps.next(bytes.subarray(next.value.offset, next.value.offset + next.value.length)); }
    const layout = next.value, output = new Uint8Array(layout.size);
    for (let offset = 0; offset < output.length; offset += 8192) {
        yield;
        const reads = layout.read(offset, Math.min(8192, output.length - offset));
        let part = reads.next();
        while (!part.done) part = reads.next(cache.subarray(part.value.offset, part.value.offset + part.value.length));
        output.set(part.value, offset);
    }
    return output;
}
