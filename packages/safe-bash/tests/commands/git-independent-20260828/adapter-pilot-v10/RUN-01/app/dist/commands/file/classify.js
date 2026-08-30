export const binary = { description: "data", mime: "application/octet-stream", encoding: "binary" };
function result(description, mime, encoding = "binary") {
    return { description, mime, encoding };
}
function matches(bytes, signature, offset = 0) {
    return bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);
}
function ascii(bytes, start, length) {
    return String.fromCharCode(...bytes.subarray(start, start + length));
}
function magic(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length >= 33 && matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10]) && view.getUint32(8) === 13 && ascii(bytes, 12, 4) === "IHDR"
        && view.getUint32(16) > 0 && view.getUint32(20) > 0 && bytes[26] === 0 && bytes[27] === 0 && bytes[28] <= 1) {
        const allowed = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (allowed[bytes[25]]?.includes(bytes[24]))
            return result("PNG image data", "image/png");
    }
    if (bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)) && view.getUint16(6, true) > 0 && view.getUint16(8, true) > 0)
        return result("GIF image data", "image/gif");
    if (bytes.length >= 4 && matches(bytes, [255, 216, 255]) && bytes[3] >= 192 && bytes[3] <= 254)
        return result("JPEG image data", "image/jpeg");
    if (bytes.length >= 20 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes, 12, 4)) && view.getUint32(4, true) >= 12)
        return result("WebP image data", "image/webp");
    if (bytes.length >= 8 && (matches(bytes, [73, 73, 42, 0]) || matches(bytes, [77, 77, 0, 42])))
        return result("TIFF image data", "image/tiff");
    if (bytes.length >= 26 && ascii(bytes, 0, 2) === "BM" && [12, 40, 52, 56, 108, 124].includes(view.getUint32(14, true)))
        return result("PC bitmap image data", "image/bmp");
    if (bytes.length >= 22 && matches(bytes, [0, 0, 1, 0]) && view.getUint16(4, true) > 0)
        return result("MS Windows icon resource", "image/vnd.microsoft.icon");
    if (/^%PDF-[12]\.[0-9](?:\r|\n|\s)/u.test(ascii(bytes, 0, 16)))
        return result("PDF document", "application/pdf");
    if (bytes.length >= 10 && matches(bytes, [31, 139, 8]) && (bytes[3] & 224) === 0)
        return result("gzip compressed data", "application/gzip");
    if (bytes.length >= 10 && ascii(bytes, 0, 3) === "BZh" && bytes[3] >= 49 && bytes[3] <= 57 && (ascii(bytes, 4, 6) === "1AY&SY" || matches(bytes, [23, 114, 69, 56, 80, 144], 4)))
        return result("bzip2 compressed data", "application/x-bzip2");
    if (bytes.length >= 12 && matches(bytes, [253, 55, 122, 88, 90, 0]) && bytes[6] === 0 && bytes[7] <= 15)
        return result("XZ compressed data", "application/x-xz");
    if (bytes.length >= 6 && matches(bytes, [40, 181, 47, 253]) && (bytes[4] & 24) === 0)
        return result("Zstandard compressed data", "application/zstd");
    if ((bytes.length >= 30 && matches(bytes, [80, 75, 3, 4])) || (bytes.length >= 22 && matches(bytes, [80, 75, 5, 6])))
        return result("Zip archive data", "application/zip");
    if (bytes.length >= 32 && matches(bytes, [55, 122, 188, 175, 39, 28]))
        return result("7-zip archive data", "application/x-7z-compressed");
    if ((bytes.length >= 14 && matches(bytes, [82, 97, 114, 33, 26, 7, 0])) || (bytes.length >= 16 && matches(bytes, [82, 97, 114, 33, 26, 7, 1, 0])))
        return result("RAR archive data", "application/x-rar");
    if (bytes.length >= 512 && ascii(bytes, 257, 5) === "ustar") {
        const checksum = ascii(bytes, 148, 8).replace(/\0.*$/u, "").trim();
        if (/^[0-7]+$/u.test(checksum)) {
            let total = 0;
            for (let index = 0; index < 512; index++)
                total += index >= 148 && index < 156 ? 32 : bytes[index];
            if (parseInt(checksum, 8) === total)
                return result("POSIX tar archive", "application/x-tar");
        }
    }
    if (bytes.length >= 52 && matches(bytes, [127, 69, 76, 70]) && [1, 2].includes(bytes[4]) && [1, 2].includes(bytes[5]) && bytes[6] === 1 && (bytes[4] === 1 || bytes.length >= 64)) {
        const type = view.getUint16(16, bytes[5] === 1);
        const mime = type === 1 ? "application/x-object" : type === 2 ? "application/x-executable" : type === 3 ? "application/x-sharedlib" : "application/octet-stream";
        return result(`ELF ${bytes[4] === 1 ? "32" : "64"}-bit ${type === 2 ? "executable" : type === 3 ? "shared object" : "object"}`, mime);
    }
    if (bytes.length >= 64 && ascii(bytes, 0, 2) === "MZ") {
        const offset = view.getUint32(60, true);
        if (offset >= 64 && offset <= bytes.length - 24 && matches(bytes, [80, 69, 0, 0], offset))
            return result("PE executable", "application/vnd.microsoft.portable-executable");
        return result("DOS executable", "application/x-dosexec");
    }
    if (bytes.length >= 8 && matches(bytes, [0, 97, 115, 109, 1, 0, 0, 0]))
        return result("WebAssembly binary module", "application/wasm");
    if (bytes.length >= 100 && ascii(bytes, 0, 16) === "SQLite format 3\0") {
        const size = view.getUint16(16);
        if ((size === 1 || (size >= 512 && size <= 32768 && (size & (size - 1)) === 0)) && [1, 2].includes(bytes[18]) && [1, 2].includes(bytes[19]) && matches(bytes, [64, 32, 32], 21))
            return result("SQLite 3.x database", "application/vnd.sqlite3");
    }
    if (bytes.length >= 512 && matches(bytes, [208, 207, 17, 224, 161, 177, 26, 225]) && matches(bytes, [254, 255], 28))
        return result("OLE Compound Document", "application/x-ole-storage");
    return undefined;
}
export function classify(bytes, complete) {
    if (!bytes.length)
        return complete ? result("empty", "inode/x-empty") : binary;
    const recognized = magic(bytes);
    if (recognized)
        return recognized;
    if (matches(bytes, [255, 254, 0, 0]) || matches(bytes, [0, 0, 254, 255]))
        return binary;
    let encoding = "utf-8";
    let bom = 0;
    if (matches(bytes, [239, 187, 191]))
        bom = 3;
    else if (matches(bytes, [255, 254])) {
        encoding = "utf-16le";
        bom = 2;
    }
    else if (matches(bytes, [254, 255])) {
        encoding = "utf-16be";
        bom = 2;
    }
    let text;
    try {
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: !complete });
    }
    catch {
        return binary;
    }
    if (!text.length && bytes.length > bom)
        return binary;
    for (const character of text) {
        const code = character.codePointAt(0);
        if ((code < 32 && ![8, 9, 10, 12, 13, 27].includes(code)) || (code >= 127 && code <= 159))
            return binary;
    }
    if (!bom && encoding === "utf-8" && bytes.every(value => value < 128))
        encoding = "us-ascii";
    if (complete && /^[\x20\t\r\n]*(?:\{|\[)/u.test(text)) {
        try {
            JSON.parse(text);
            return result("JSON text data", "application/json", encoding);
        }
        catch { }
    }
    const description = encoding === "us-ascii" ? "ASCII text" : encoding === "utf-8" ? "Unicode text, UTF-8" : `Unicode text, ${encoding === "utf-16le" ? "UTF-16, little-endian" : "UTF-16, big-endian"}`;
    return result(description, "text/plain", encoding);
}
//# sourceMappingURL=classify.js.map