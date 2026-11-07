import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

export function* ftxtPixels(image: Pick<RgbaImage, "width" | "space" | "hasAlpha" | "data" | "data16">, format = "\\x,\\y:\\c\\n", start = 0): Generator<string> {
    const channels = image.space === "b-w" || image.space === "grey16" ? [0] : [0, 1, 2];
    if (image.hasAlpha) channels.push(3);
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const pixel = (start + offset) / 4;
        let row = "";
        for (let i = 0; i < format.length; i++) {
            if (format[i] !== "\\") { row += format[i]; continue; }
            const escape = format[++i];
            if (escape === "x") row += pixel % image.width;
            else if (escape === "y") row += Math.floor(pixel / image.width);
            else if (escape === "c") row += channels.map(channel => image.data16?.[offset + channel] ?? image.data[offset + channel]! * 257).join(",");
            else if (escape === "n") row += "\n";
            else if (escape === "r") row += "\r";
            else if (escape === "t") row += "\t";
            else row += escape ?? "";
        }
        yield row;
    }
}

export async function* storedFtxt(image: StoredRgbaImage, storage: PagedStorage, signal: AbortSignal, format?: string): AsyncGenerator<string> {
    const size = image.width * image.height * 4;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const data = await storage.read(image.position + start, Math.min(16384, size - start));
        const original = image.storedData16 ? await storage.read(image.storedData16.position + start * 2, data.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        yield* ftxtPixels({ ...image, data, ...(data16 ? { data16 } : {}) }, format, start);
    }
}
