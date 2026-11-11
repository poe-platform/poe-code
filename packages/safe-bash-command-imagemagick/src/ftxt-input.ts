// Present FTXT records as Q16 Netpbm to share raster decoding.
export function* ftxtInput(width: number, height: number, size: number, format = "\\x,\\y:\\c\\n", hasAlpha = false, separator = ","): Generator<{ position: number; length: number } | Uint8Array, void, Uint8Array> {
    const parts: (string | { field: string })[] = [""];
    for (let index = 0; index < format.length; index++) {
        let character = format[index]!;
        if (character === "\\") {
            character = format[++index] ?? "";
            if (character === "x" || character === "y" || character === "c") {
                parts.push({ field: character }, "");
                continue;
            }
            if (character === "n") character = "\n";
            else if (character === "r") character = "\r";
            else if (character === "t") character = "\t";
        }
        parts[parts.length - 1] += character;
    }
    parts[0] = (parts[0] as string).trimStart();
    parts[parts.length - 1] = (parts[parts.length - 1] as string).trimEnd();
    const pixels = width * height, channels = hasAlpha ? 4 : 3;
    if (!Number.isSafeInteger(pixels * channels * 2) || width < 1 || height < 1 || pixels > size) throw new Error("invalid FTXT image size or truncated input");
    yield new TextEncoder().encode(hasAlpha ? `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n` : `P6\n${width} ${height}\n65535\n`);
    let line = "", pixel = 0, used = 0;
    const output = new Uint8Array(Math.floor(8192 / (channels * 2)) * channels * 2);
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
            let cursor = 0;
            let values: number[] = [];
            for (let part = 0; part < parts.length; part++) {
                const token = parts[part]!;
                if (typeof token === "string") {
                    if (!record.startsWith(token, cursor)) throw new Error("invalid FTXT pixel");
                    cursor += token.length;
                } else {
                    const delimiter = parts[part + 1] as string;
                    const end = delimiter ? record.indexOf(delimiter, cursor) : record.length;
                    if (end < 0) throw new Error("invalid FTXT pixel");
                    const value = record.slice(cursor, end).trim();
                    if (token.field === "c") values = value.split(separator).map(value => {
                        const sample = value.trim(), percent = sample.endsWith("%");
                        const number = percent ? sample.slice(0, -1).trim() : sample;
                        return number ? Number(number) * (percent ? 65535 / 100 : 1) : NaN;
                    });
                    else if (!value || Number(value) !== (token.field === "x" ? pixel % width : Math.floor(pixel / width))) throw new Error("invalid FTXT pixel");
                    cursor = end;
                }
            }
            if (cursor !== record.length || pixel >= pixels || values.length !== channels || values.some(value => !Number.isFinite(value) || value < 0 || value > 65535)) throw new Error("invalid FTXT pixel");
            for (const value of values) { const sample = Math.round(value); output[used++] = sample >>> 8; output[used++] = sample & 255; }
            pixel++;
            if (used === output.length) { yield output; used = 0; }
        }
    }
    if (pixel !== pixels) throw new Error("truncated FTXT pixels");
    if (used) yield output.subarray(0, used);
}
