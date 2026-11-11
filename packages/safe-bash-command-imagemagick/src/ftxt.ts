import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { formatSignificantMetric } from "./compare-kernel.js";
import type { HueMetadata } from "./colorspace-hue.js";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import { yieldTurn } from "safe-bash-contracts/yield";

export function* ftxtPixels(image: Pick<RgbaImage, "width" | "space" | "hasAlpha" | "data" | "data16" | "evaluateSamples" | "depth" | "bitsPerSample" | "gamma"> & HueMetadata, format = "\\x,\\y:\\c\\n", start = 0, precision = 6, separator = ","): Generator<string> {
    const gray = image.space === "b-w" || image.space === "grey16";
    const channels = gray ? [0] : [0, 1, 2];
    const depth = Math.min(32, image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8));
    const hexWidth = depth <= 8 ? 2 : depth <= 16 ? 4 : 8;
    const maximum = 2 ** (hexWidth * 4) - 1;
    const colorspace = gray ? image.gamma === 1 && image.magickColorspace !== "Gray" ? "lineargray" : "gray" : image.space === "cmyk" ? "cmyk" : image.magickColorspace?.toLowerCase() ?? "srgb";
    // Native FTXT keeps the percentage suffix for the rest of the image.
    let suffix = "";
    if (start > 0) for (let i = 0; i < format.length; i++) {
        if (format[i] === "\\" && format[++i] === "p") suffix = "%";
    }
    if (image.hasAlpha) channels.push(3);
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const pixel = (start + offset) / 4;
        const values = channels.map(channel => image.evaluateSamples ? Math.fround(image.evaluateSamples[offset + channel]! * 257) : image.data16?.[offset + channel] ?? image.data[offset + channel]! * 257);
        const inks = image.space === "cmyk" ? image.hueSamples?.subarray(offset, offset + 4) ?? rgbToCmyk(values[0]! / 65535, values[1]! / 65535, values[2]! / 65535) : undefined;
        // Black is the fourth working ink; alpha remains in the RGBA backing.
        if (inks) values.splice(0, 3, ...Array.from(inks, value => Math.fround(value * 65535)));
        let row = "", floatingHex = false;
        for (let i = 0; i < format.length; i++) {
            if (format[i] !== "\\") { row += format[i]; continue; }
            const escape = format[++i];
            if (escape === "x") row += pixel % image.width;
            else if (escape === "y") row += Math.floor(pixel / image.width);
            else if (escape === "c" || escape === "h" || escape === "o" || escape === "p" || escape === "f") {
                if (escape === "p") suffix = "%";
                if (escape === "f") floatingHex = true;
                row += values.map(value => {
                    if (escape === "h") return `#${Math.round(value).toString(16)}`;
                    if (floatingHex) {
                        if (value === 0) return "0x0p+0";
                        const exponent = Math.floor(Math.log2(Math.abs(value)));
                        return `${value < 0 ? "-" : ""}0x${(Math.abs(value) / 2 ** exponent).toString(16)}p${exponent >= 0 ? "+" : ""}${exponent}`;
                    }
                    return formatSignificantMetric(value * (escape === "o" ? 1 / 65535 : escape === "p" ? 100 / 65535 : 1), precision) + suffix;
                }).join(separator);
            }
            else if (escape === "H") {
                const rgb = gray ? [values[0]!, values[0]!, values[0]!, ...values.slice(1)] : values;
                row += "#" + rgb.map(value => Math.round(Math.max(0, Math.min(65535, value)) * maximum / 65535).toString(16).toUpperCase().padStart(hexWidth, "0")).join("");
            }
            else if (escape === "s") {
                const color = values.slice(0, gray ? 1 : inks ? 4 : 3);
                const percent = !inks && color.some(value => Math.abs(value - Math.round(value / 257) * 257) >= 1e-6);
                const tuple = color.map(value => formatSignificantMetric(value * (percent ? 100 / 65535 : 1 / 257), precision) + (percent ? "%" : ""));
                if (image.hasAlpha) tuple.push(formatSignificantMetric(values.at(-1)! / 65535, precision));
                row += `${colorspace}${image.hasAlpha ? "a" : ""}(${tuple.join(",")})`;
            }
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
