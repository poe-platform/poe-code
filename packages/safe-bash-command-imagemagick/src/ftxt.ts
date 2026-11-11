import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { formatSignificantMetric } from "./compare-kernel.js";
import { yieldTurn } from "safe-bash-contracts/yield";

export function* ftxtPixels(image: Pick<RgbaImage, "width" | "space" | "hasAlpha" | "data" | "data16" | "evaluateSamples">, format = "\\x,\\y:\\c\\n", start = 0, precision = 6): Generator<string> {
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
            // Q16-HDRI stores fractional quantum samples as single-precision floats.
            else if (escape === "c") row += channels.map(channel => formatSignificantMetric(image.evaluateSamples ? Math.fround(image.evaluateSamples[offset + channel]! * 257) : image.data16?.[offset + channel] ?? image.data[offset + channel]! * 257, precision)).join(",");
            else if (escape === "n") row += "\n";
            else if (escape === "\\") row += escape;
        }
        yield row;
    }
}

export async function* storedFtxt(image: StoredRgbaImage, storage: PagedStorage, signal: AbortSignal, format?: string, precision?: number): AsyncGenerator<string> {
    const size = image.width * image.height * 4;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const data = await storage.read(image.position + start, Math.min(16384, size - start));
        const original = image.storedData16 ? await storage.read(image.storedData16.position + start * 2, data.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        const evaluated = image.storedEvaluateSamples === undefined ? undefined : await storage.read(image.storedEvaluateSamples + start * 8, data.length * 8);
        const evaluateSamples = evaluated ? new Float64Array(evaluated.slice().buffer) : undefined;
        yield* ftxtPixels({ ...image, data, ...(data16 ? { data16 } : {}), ...(evaluateSamples ? { evaluateSamples } : {}) }, format, start, precision);
    }
}
