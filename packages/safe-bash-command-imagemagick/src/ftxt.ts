import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { formatSignificantMetric } from "./compare-kernel.js";
import type { HueMetadata } from "./colorspace-hue.js";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import { yieldTurn } from "safe-bash-contracts/yield";

export function* ftxtPixels(image: Pick<RgbaImage, "width" | "space" | "hasAlpha" | "data" | "data16" | "evaluateSamples"> & HueMetadata, format = "\\x,\\y:\\c\\n", start = 0, precision = 6, separator = ","): Generator<string> {
    const channels = image.space === "b-w" || image.space === "grey16" ? [0] : [0, 1, 2];
    if (image.hasAlpha) channels.push(3);
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const pixel = (start + offset) / 4;
        const values = channels.map(channel => image.evaluateSamples ? Math.fround(image.evaluateSamples[offset + channel]! * 257) : image.data16?.[offset + channel] ?? image.data[offset + channel]! * 257);
        const inks = image.space === "cmyk" ? image.hueSamples?.subarray(offset, offset + 4) ?? rgbToCmyk(values[0]! / 65535, values[1]! / 65535, values[2]! / 65535) : undefined;
        // Black is the fourth working ink; alpha remains in the RGBA backing.
        if (inks) values.splice(0, 3, ...Array.from(inks, value => Math.fround(value * 65535)));
        let row = "";
        for (let i = 0; i < format.length; i++) {
            if (format[i] !== "\\") { row += format[i]; continue; }
            const escape = format[++i];
            if (escape === "x") row += pixel % image.width;
            else if (escape === "y") row += Math.floor(pixel / image.width);
            else if (escape === "c") row += values.map(value => formatSignificantMetric(value, precision)).join(separator);
            else if (escape === "n") row += "\n";
            else if (escape === "\\") row += escape;
        }
        yield row;
    }
}

export async function* storedFtxt(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal, format?: string, precision?: number, separator?: string): AsyncGenerator<string> {
    const size = image.width * image.height * 4;
    for (let start = 0; start < size; start += 2048) {
        await yieldTurn(signal);
        const data = await storage.read(image.position + start, Math.min(2048, size - start));
        const original = image.storedData16 ? await storage.read(image.storedData16.position + start * 2, data.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        const evaluated = image.storedEvaluateSamples === undefined ? undefined : await storage.read(image.storedEvaluateSamples + start * 8, data.length * 8);
        const evaluateSamples = evaluated ? new Float64Array(evaluated.slice().buffer) : undefined;
        const inks = image.space === "cmyk" && image.storedHueSamples !== undefined ? await storage.read(image.storedHueSamples + start * 8, data.length * 8) : undefined;
        const hueSamples = inks ? new Float64Array(inks.slice().buffer) : undefined;
        yield* ftxtPixels({ ...image, data, ...(hueSamples ? { hueSamples } : {}), ...(data16 ? { data16 } : {}), ...(evaluateSamples ? { evaluateSamples } : {}) }, format, start, precision, separator);
    }
}
