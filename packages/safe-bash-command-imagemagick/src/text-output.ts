import { formatSignificantMetric } from "./compare-kernel.js";
import { formatCmykPixel, rgbToCmyk } from "./colorspace-cmyk.js";
import { histogramColorNames } from "./histogram-color-names.js";
import { formatHuePixel, hueTextPixel, type HueMetadata } from "./colorspace-hue.js";
import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

const hex = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
export function pixelEnumerationLine(x: number, y: number, r: number, g: number, b: number, a: number, colorspace = "srgba", working?: Float64Array): string {
    const alpha = colorspace.endsWith("a");
    const gray = colorspace.startsWith("gray") || colorspace.startsWith("lineargray");
    const samples = gray ? String(r) : `${r},${g},${b}`;
    const channels = working && (gray || colorspace === "rgb" || colorspace === "rgba") ? working.subarray(0, gray ? 1 : 3) : undefined;
    const fractional = channels?.some(value => Math.abs(value - Math.round(value)) > 1e-9);
    const description = fractional ? Array.from(channels!, value => `${Number((value * 100 / 255).toPrecision(6))}%`).join(",") : samples;
    const name = colorspace === "srgba" && a === 255 ? histogramColorNames[(r << 16) | (g << 8) | b] : undefined;
    return `${x},${y}: (${samples}${alpha ? `,${a}` : ""})  #${hex(r)}${hex(g)}${hex(b)}${alpha ? hex(a) : ""}  ${name ?? `${colorspace}(${description}${alpha ? `,${Number(((channels ? working![3]! : a) / 255).toPrecision(6))}` : ""})`}`;
}
export function srgbDepthEnumerationLine(x: number, y: number, samples: Uint8Array | Uint16Array, hasAlpha: boolean, depth: number): string {
    const levels = 2 ** Math.min(depth, 16) - 1, maximum = depth <= 8 ? 255 : 65535;
    const sourceMaximum = samples instanceof Uint16Array ? 65535 : 255;
    const working = Array.from(samples.subarray(0, hasAlpha ? 4 : 3), value => Math.round(value * levels / sourceMaximum) / levels);
    const channels = working.map(value => Math.round(value * maximum));
    const color = channels.map(value => hex(value).padStart(maximum === 255 ? 2 : 4, "0")).join("");
    const rgb = channels.slice(0, 3);
    const percent = working.slice(0, 3).some(value => Math.abs(value * 255 - Math.round(value * 255)) > 1e-9);
    const values = working.slice(0, 3).map(value => percent ? `${Number((value * 100).toPrecision(6))}%` : String(Math.round(value * 255)));
    if (hasAlpha) values.push(String(Number(working[3]!.toPrecision(6))));
    const name = !hasAlpha || channels[3] === maximum ? histogramColorNames[(Math.round(rgb[0]! * 255 / maximum) << 16) | (Math.round(rgb[1]! * 255 / maximum) << 8) | Math.round(rgb[2]! * 255 / maximum)] : undefined;
    return `${x},${y}: (${channels.join(",")})  #${color}  ${name && !percent ? name : `srgb${hasAlpha ? "a" : ""}(${values.join(",")})`}`;
}
export function cmykEnumerationLine(x: number, y: number, inks: ArrayLike<number>, alpha: number | undefined, maximum: number): string {
    const samples = Array.from(inks);
    if (alpha !== undefined) samples.push(alpha);
    const channels = samples.map(value => Math.round(Math.max(0, Math.min(1, value)) * maximum));
    const color = channels.map(value => hex(value).padStart(maximum === 255 ? 2 : 4, "0")).join("");
    const values = samples.map((value, channel) => Number((value * (channel === 4 ? 1 : 255)).toPrecision(6)));
    return `${x},${y}: (${channels.join(",")})  #${color}  cmyk${alpha === undefined ? "" : "a"}(${values.join(",")})`;
}
export function gray16EnumerationLine(x: number, y: number, gray: number, alpha: number | undefined, colorspace: string, working?: Float64Array): string {
    const sample = working?.[0] ?? gray / 257;
    const value = Math.abs(sample - Math.round(sample)) <= 1e-9 ? String(Math.round(sample)) : `${Number((sample * 100 / 255).toPrecision(6))}%`;
    const color = hex(gray).padStart(4, "0").repeat(3);
    return `${x},${y}: (${gray}${alpha === undefined ? "" : `,${alpha}`})  #${color}${alpha === undefined ? "" : hex(alpha).padStart(4, "0")}  ${colorspace}(${value}${alpha === undefined ? "" : `,${Number((working ? working[3]! / 255 : alpha / 65535).toPrecision(6))}`})`;
}
export function histogramLine(key: number | bigint, count: number, hasAlpha: boolean, highDepth = typeof key === "bigint", precision = 6): string {
    const sourceMaximum = typeof key === "bigint" ? 65535 : 255;
    const maximum = highDepth ? 65535 : 255;
    const samples = (typeof key === "bigint"
        ? [48n, 32n, 16n, ...(hasAlpha ? [0n] : [])].map(shift => Number((key >> shift) & 65535n))
        : [24, 16, 8, ...(hasAlpha ? [0] : [])].map(shift => (key >>> shift) & 255))
        .map(value => Math.round(value * maximum / sourceMaximum));
    const rgb = samples.slice(0, 3);
    const percent = highDepth && rgb.some(value => value % 257 !== 0);
    const values = rgb.map(value => percent ? `${Number((value * 100 / maximum).toPrecision(6))}%` : String(value / (highDepth ? 257 : 1)));
    if (hasAlpha) values.push(String(Number((samples[3]! / maximum).toPrecision(6))));
    const name = !percent && !hasAlpha
        ? histogramColorNames[(Number(values[0]) << 16) | (Number(values[1]) << 8) | Number(values[2])] : undefined;
    return `${hasAlpha && !highDepth ? `  ${count}` : String(count).padStart(14)}: (${samples.map(value => formatSignificantMetric(value, precision)).join(",")}) #${samples.map(value => hex(value).padStart(highDepth ? 4 : 2, "0")).join("")} ${name ?? `srgb${hasAlpha ? "a" : ""}(${values.join(",")})`}`;
}
export function sourceHistogramSamples(data: Uint8Array | Uint16Array | Float64Array, cmyk: boolean, inks?: Float64Array): Float64Array {
    const samples = data instanceof Float64Array ? data : Float64Array.from(data, value => value / (data instanceof Uint16Array ? 257 : 1));
    if (!cmyk) return samples;
    const channels = inks ?? rgbToCmyk(samples[0]! / 255, samples[1]! / 255, samples[2]! / 255);
    return Float64Array.of(...Array.from(channels, value => value * 255), samples[3]!);
}
// Sort IEEE doubles by numeric value, keeping the complete tuple as the bin key.
export function floatingHistogramKey(samples: Float64Array, hasAlpha: boolean): bigint {
    const bits = new DataView(new ArrayBuffer(8));
    let key = 0n;
    for (let channel = 0; channel < samples.length; channel++) {
        bits.setFloat64(0, channel === samples.length - 1 && !hasAlpha ? 255 : samples[channel]! || 0);
        const value = bits.getBigUint64(0);
        key = (key << 64n) | (value >> 63n ? BigInt.asUintN(64, ~value) : value ^ (1n << 63n));
    }
    return key;
}
export function floatingHistogramLine(key: bigint, count: number, hasAlpha: boolean, highDepth: boolean, colorspace = "srgb", precision = 6): string {
    const bits = new DataView(new ArrayBuffer(8));
    const samples = [...(colorspace === "cmyk" ? [256n] : []), 192n, 128n, 64n, ...(hasAlpha ? [0n] : [])].map(shift => {
        const value = BigInt.asUintN(64, key >> shift);
        bits.setBigUint64(0, value >> 63n ? value ^ (1n << 63n) : BigInt.asUintN(64, ~value));
        return bits.getFloat64(0);
    });
    if (colorspace === "srgb" && samples.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
        const packed = samples.reduce((key, value) => key * 256 + value, 0) * (hasAlpha ? 1 : 256);
        return histogramLine(packed, count, hasAlpha, highDepth, precision);
    }
    const scale = highDepth ? 257 : 1, maximum = highDepth ? 65535 : 255;
    const color = samples.map(value => hex(Math.round(Math.max(0, Math.min(maximum, value * scale)))).padStart(highDepth ? 4 : 2, "0")).join("");
    const channels = samples.slice(0, colorspace === "cmyk" ? 4 : colorspace.endsWith("gray") ? 1 : 3);
    const percent = colorspace !== "cmyk" && (colorspace === "srgb" || channels.some(value => Math.abs(value - Math.round(value)) > 1e-9));
    const values = channels.map(value => percent ? `${Number((value * 100 / 255).toPrecision(6))}%` : String(Number(value.toPrecision(6))));
    if (hasAlpha) values.push(String(Number((samples.at(-1)! / 255).toPrecision(6))));
    return `${colorspace === "srgb" ? `  ${count}` : String(count).padStart(14)}: (${samples.map(value => formatSignificantMetric(value * scale, precision)).join(",")}) #${color} ${colorspace}${hasAlpha ? "a" : ""}(${values.join(",")})`;
}
async function* storedFloatingHistogram(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal, precision = 6): AsyncGenerator<string> {
    const cmyk = image.space === "cmyk", gray = image.space === "b-w" || image.space === "grey16";
    const colorspace = cmyk ? "cmyk" : gray ? image.gamma === 1 && image.magickColorspace !== "Gray" ? "lineargray" : "gray" : "srgb";
    const highDepth = (image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8)) > 8;
    const levels = cmyk ? 20 : 16;
    // A radix tree over the full tuple uses the existing bounded,
    // spillable integer table. Leaf values are counts; internal values are node IDs.
    const tree = new IntegerTable(storage, 512);
    let nextNode = 1n;
    const size = image.width * image.height * 4;
    for (let start = 0; start < size; start += 2048) {
        const length = Math.min(2048, size - start);
        const evaluated = image.storedEvaluateSamples === undefined ? undefined : await storage.read(image.storedEvaluateSamples + start * 8, length * 8);
        const backing = evaluated ? undefined : await storage.read((image.storedData16?.position ?? image.position) + start * (image.storedData16 ? 2 : 1), length * (image.storedData16 ? 2 : 1));
        const samples = evaluated ? new Float64Array(evaluated.slice().buffer) : sourceHistogramSamples(image.storedData16 ? new Uint16Array(backing!.slice().buffer) : backing!, false);
        const inkBytes = cmyk && image.storedHueSamples !== undefined ? await storage.read(image.storedHueSamples + start * 8, length * 8) : undefined;
        const inks = inkBytes ? new Float64Array(inkBytes.slice().buffer) : undefined;
        for (let offset = 0; offset < samples.length; offset += 4) {
            if (offset % 128 === 0) await yieldTurn(signal);
            const pixel = samples.subarray(offset, offset + 4);
            const channels = sourceHistogramSamples(pixel, cmyk, inks?.subarray(offset, offset + 4));
            const key = floatingHistogramKey(channels, image.hasAlpha);
            let node = 0n;
            for (let shift = BigInt((levels - 1) * 16); shift >= 0n; shift -= 16n) {
                const edge = (node << 16n) | ((key >> shift) & 65535n);
                const value = await tree.get(edge);
                if (shift === 0n) await tree.set(edge, (value ?? 0n) + 1n);
                else {
                    node = value ?? nextNode++;
                    if (value === undefined) await tree.set(edge, node);
                }
            }
        }
    }
    async function* visit(node: bigint, depth: number, prefix: bigint): AsyncGenerator<string> {
        await yieldTurn(signal);
        for await (const [edge, value] of tree.entries(node << 16n, (node + 1n) << 16n)) {
            const key = (prefix << 16n) | (edge & 65535n);
            if (depth === levels - 1) yield floatingHistogramLine(key, Number(value), image.hasAlpha, highDepth, colorspace, precision) + "\n";
            else yield* visit(value, depth + 1, key);
        }
    }
    yield* visit(0n, 0, 0n);
    if (!size) yield "\n";
}
export function* sparseColorPoints(image: Pick<RgbaImage, "width" | "space" | "hasAlpha" | "gamma" | "evaluateSamples"> & HueMetadata, data: Uint8Array | Uint16Array, start = 0, precision = 6, hueSamples = image.hueSamples?.subarray(start * 4), working = image.evaluateSamples?.subarray(start * 4)): Generator<string> {
    const maximum = data instanceof Uint16Array ? 65535 : 255;
    const gray = image.space === "b-w" || image.space === "grey16";
    const space = image.magickColorspace;
    for (let offset = 0; offset < data.length; offset += 4) {
        const alpha = working ? working[offset + 3]! / 255 : data[offset + 3]! / maximum;
        if (image.hasAlpha && alpha !== 1) continue;
        const pixel = start + offset / 4;
        let color: string;
        if (image.space === "cmyk") {
            const inks = hueSamples?.subarray(offset, offset + 4) ?? rgbToCmyk(data[offset]! / maximum, data[offset + 1]! / maximum, data[offset + 2]! / maximum);
            color = formatCmykPixel([...inks, alpha], image.hasAlpha, precision);
        } else if (space && space !== "RGB" && space !== "Gray") {
            const channels = hueSamples ? Array.from(hueSamples.subarray(offset, offset + 4))
                : Array.from(data.subarray(offset, offset + 4), value => value / maximum);
            color = formatHuePixel(channels, space, image.hasAlpha, precision);
        } else {
            const channels = working ? Array.from(working.subarray(offset, offset + (gray ? 1 : 3)))
                : Array.from(data.subarray(offset, offset + (gray ? 1 : 3)), value => value * 255 / maximum);
            const percent = channels.some(value => Math.abs(value - Math.round(value)) > 1e-9);
            const samples = channels.map(value => percent ? `${Number((value * 100 / 255).toPrecision(precision))}%` : String(Math.round(value)));
            if (image.hasAlpha) samples.push("1");
            const name = gray ? image.gamma === 1 && space !== "Gray" ? "lineargray" : "gray" : space === "RGB" ? "rgb" : "srgb";
            color = `${name}${image.hasAlpha ? "a" : ""}(${samples.join(",")})`;
        }
        yield `${pixel % image.width},${Math.floor(pixel / image.width)},${color} `;
    }
}
export async function* storedSparseColor(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal, precision?: number): AsyncGenerator<string> {
    const size = image.width * image.height * 4, highDepth = image.storedData16 !== undefined;
    for (let start = 0; start < size; start += 2048) {
        await yieldTurn(signal);
        const length = Math.min(2048, size - start);
        const bytes = await storage.read((image.storedData16?.position ?? image.position) + start * (highDepth ? 2 : 1), length * (highDepth ? 2 : 1));
        const data = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
        const hues = image.storedHueSamples === undefined ? undefined : await storage.read(image.storedHueSamples + start * 8, length * 8);
        const evaluated = image.storedEvaluateSamples === undefined ? undefined : await storage.read(image.storedEvaluateSamples + start * 8, length * 8);
        yield* sparseColorPoints(image, data, start / 4, precision, hues ? new Float64Array(hues.slice().buffer) : undefined, evaluated ? new Float64Array(evaluated.slice().buffer) : undefined);
    }
}
export async function* storedPixelEnumeration(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal, depth?: number): AsyncGenerator<string> {
    if (image.space === "cmyk") {
        const maximum = (depth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8)) <= 8 ? 255 : 65535;
        yield `# ImageMagick pixel enumeration: ${image.width},${image.height},0,${maximum},cmyk${image.hasAlpha ? "a" : ""}\n`;
        const size = image.width * image.height * 4;
        for (let start = 0; start < size; start += 16384) {
            await yieldTurn(signal);
            const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
            const original = image.storedData16 ? await storage.read(image.storedData16.position + start * 2, bytes.length * 2) : undefined;
            const backing = original ? new Uint16Array(original.slice().buffer) : bytes;
            const scale = original ? 65535 : 255;
            const storedInks = image.storedHueSamples === undefined ? undefined : await storage.read(image.storedHueSamples + start * 8, bytes.length * 8);
            const inks = storedInks ? new Float64Array(storedInks.slice().buffer) : undefined;
            const evaluated = image.storedEvaluateSamples === undefined ? undefined : await storage.read(image.storedEvaluateSamples + start * 8, bytes.length * 8);
            const samples = evaluated ? new Float64Array(evaluated.slice().buffer) : undefined;
            for (let offset = 0; offset < bytes.length; offset += 4) {
                const pixel = (start + offset) / 4;
                const channels = inks?.subarray(offset, offset + 4) ?? rgbToCmyk(backing[offset]! / scale, backing[offset + 1]! / scale, backing[offset + 2]! / scale);
                const alpha = image.hasAlpha ? samples ? samples[offset + 3]! / 255 : backing[offset + 3]! / scale : undefined;
                yield cmykEnumerationLine(pixel % image.width, Math.floor(pixel / image.width), channels, alpha, maximum) + "\n";
            }
        }
        return;
    }
    const maximum = ["HCL", "HCLp", "HSI", "HSL", "HSB", "HSV", "HWB", "XYZ", "CIELab"].includes(image.magickColorspace ?? "") && (depth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8)) <= 8 ? 255 : 65535;
    const srgbDepth = depth !== undefined && image.space === "srgb" && !image.magickColorspace;
    const colorspace = `${image.space === "b-w" || image.space === "grey16" ? image.gamma === 1 && image.magickColorspace !== "Gray" ? "lineargray" : "gray" : image.magickColorspace === "RGB" ? "rgb" : "srgb"}${image.hasAlpha ? "a" : ""}`;
    const gray16 = (image.space === "b-w" || image.space === "grey16") && image.storedData16 !== undefined && (depth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8)) > 8;
    yield srgbDepth ? `# ImageMagick pixel enumeration: ${image.width},${image.height},0,${depth > 8 ? 65535 : 255},srgb${image.hasAlpha ? "a" : ""}\n` : gray16 ? `# ImageMagick pixel enumeration: ${image.width},${image.height},0,65535,${colorspace}\n` : (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HSV" || image.magickColorspace === "HSI" || image.magickColorspace === "HWB" || image.magickColorspace === "LMS" || image.magickColorspace === "CAT02LMS" || image.magickColorspace === "XYZ" || image.magickColorspace === "DisplayP3" || image.magickColorspace === "xyY" || image.magickColorspace === "ProPhoto" || image.magickColorspace === "Jzazbz" || (image.magickColorspace === "YPbPr" || image.magickColorspace === "YCbCr") || image.magickColorspace === "Rec601YCbCr" || image.magickColorspace === "YCC" || image.magickColorspace === "Rec709YCbCr" || image.magickColorspace === "Log" || image.magickColorspace === "Adobe98" || image.magickColorspace === "OHTA" || image.magickColorspace === "CMY" || image.magickColorspace === "YUV" || image.magickColorspace === "YIQ" || image.magickColorspace === "YDbDr" || image.magickColorspace === "Oklab" || image.magickColorspace === "Luv" || image.magickColorspace === "Oklch" || image.magickColorspace === "LCH" || image.magickColorspace === "LCHab" || image.magickColorspace === "LCHuv" || image.magickColorspace === "CIELab") ? `# ImageMagick pixel enumeration: ${image.width},${image.height},0,${maximum},${image.magickColorspace.toLowerCase()}${image.hasAlpha ? "a" : ""}\n` : `# ImageMagick pixel enumeration: ${image.width},${image.height},0,255,${colorspace}\n`;
    const size = image.width * image.height * 4;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
        const evaluated = (image.space === "b-w" || image.space === "grey16" || image.magickColorspace === "RGB") && image.storedEvaluateSamples !== undefined
            ? await storage.read(image.storedEvaluateSamples + start * 8, bytes.length * 8) : undefined;
        const working = evaluated ? new Float64Array(evaluated.slice().buffer) : undefined;
        const original = (srgbDepth || gray16 || image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HSV" || image.magickColorspace === "HSI" || image.magickColorspace === "HWB" || image.magickColorspace === "LMS" || image.magickColorspace === "CAT02LMS" || image.magickColorspace === "XYZ" || image.magickColorspace === "DisplayP3" || image.magickColorspace === "xyY" || image.magickColorspace === "ProPhoto" || image.magickColorspace === "Jzazbz" || (image.magickColorspace === "YPbPr" || image.magickColorspace === "YCbCr") || image.magickColorspace === "Rec601YCbCr" || image.magickColorspace === "YCC" || image.magickColorspace === "Rec709YCbCr" || image.magickColorspace === "Log" || image.magickColorspace === "Adobe98" || image.magickColorspace === "OHTA" || image.magickColorspace === "CMY" || image.magickColorspace === "YUV" || image.magickColorspace === "YIQ" || image.magickColorspace === "YDbDr" || image.magickColorspace === "Oklab" || image.magickColorspace === "Luv" || image.magickColorspace === "Oklch" || image.magickColorspace === "LCH" || image.magickColorspace === "LCHab" || image.magickColorspace === "LCHuv" || image.magickColorspace === "CIELab") && image.storedData16 ? await storage.read(image.storedData16.position + start * 2, bytes.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        const samples = (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSI" || image.magickColorspace === "HWB" || image.magickColorspace === "LMS" || image.magickColorspace === "CAT02LMS" || image.magickColorspace === "XYZ" || image.magickColorspace === "DisplayP3" || image.magickColorspace === "xyY" || image.magickColorspace === "ProPhoto" || image.magickColorspace === "Jzazbz" || (image.magickColorspace === "YPbPr" || image.magickColorspace === "YCbCr") || image.magickColorspace === "Rec601YCbCr" || image.magickColorspace === "YCC" || image.magickColorspace === "Rec709YCbCr" || image.magickColorspace === "Log" || image.magickColorspace === "Adobe98" || image.magickColorspace === "OHTA" || image.magickColorspace === "CMY" || image.magickColorspace === "YUV" || image.magickColorspace === "YIQ" || image.magickColorspace === "YDbDr" || image.magickColorspace === "Oklab" || image.magickColorspace === "Luv" || image.magickColorspace === "Oklch" || image.magickColorspace === "LCH" || image.magickColorspace === "LCHab" || image.magickColorspace === "LCHuv" || image.magickColorspace === "CIELab") && image.storedHueSamples !== undefined ? await storage.read(image.storedHueSamples + start * 8, bytes.length * 8) : undefined;
        const hueSamples = samples ? new Float64Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)) : undefined;
        for (let offset = 0; offset < bytes.length; offset += 4) {
            const pixel = (start + offset) / 4;
            if (srgbDepth) {
                yield srgbDepthEnumerationLine(pixel % image.width, Math.floor(pixel / image.width), (data16 ?? bytes).subarray(offset, offset + 4), image.hasAlpha, depth) + "\n";
                continue;
            }
            if ((image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HSV" || image.magickColorspace === "HSI" || image.magickColorspace === "HWB" || image.magickColorspace === "LMS" || image.magickColorspace === "CAT02LMS" || image.magickColorspace === "XYZ" || image.magickColorspace === "DisplayP3" || image.magickColorspace === "xyY" || image.magickColorspace === "ProPhoto" || image.magickColorspace === "Jzazbz" || (image.magickColorspace === "YPbPr" || image.magickColorspace === "YCbCr") || image.magickColorspace === "Rec601YCbCr" || image.magickColorspace === "YCC" || image.magickColorspace === "Rec709YCbCr" || image.magickColorspace === "Log" || image.magickColorspace === "Adobe98" || image.magickColorspace === "OHTA" || image.magickColorspace === "CMY" || image.magickColorspace === "YUV" || image.magickColorspace === "YIQ" || image.magickColorspace === "YDbDr" || image.magickColorspace === "Oklab" || image.magickColorspace === "Luv" || image.magickColorspace === "Oklch" || image.magickColorspace === "LCH" || image.magickColorspace === "LCHab" || image.magickColorspace === "LCHuv" || image.magickColorspace === "CIELab")) {
                yield `${pixel % image.width},${Math.floor(pixel / image.width)}: ${hueTextPixel(Array.from(data16?.subarray(offset, offset + 4) ?? bytes.subarray(offset, offset + 4), value => data16 ? value : value * 257), image.hasAlpha, image.magickColorspace, hueSamples ? Array.from(hueSamples.subarray(offset, offset + 4)) : undefined, maximum)}\n`;
                continue;
            }
            if (gray16) {
                yield gray16EnumerationLine(pixel % image.width, Math.floor(pixel / image.width), data16![offset]!, image.hasAlpha ? data16![offset + 3]! : undefined, colorspace, working?.subarray(offset, offset + 4)) + "\n";
                continue;
            }
            yield pixelEnumerationLine(pixel % image.width, Math.floor(pixel / image.width), bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!, colorspace, working?.subarray(offset, offset + 4)) + "\n";
        }
    }
}
export async function* storedHistogram(image: StoredRgbaImage & HueMetadata, storage: PagedStorage, signal: AbortSignal, precision = 6): AsyncGenerator<string> {
    if (image.space === "cmyk" || image.space === "b-w" || image.space === "grey16" || image.space === "srgb" && image.storedEvaluateSamples !== undefined && (!image.magickColorspace || image.magickColorspace === "RGB")) {
        yield* storedFloatingHistogram(image, storage, signal, precision);
        return;
    }
    const hue = ["HCL", "HCLp", "HSI", "HSL", "HSB", "HSV", "HWB", "DisplayP3", "XYZ", "CAT02LMS", "LMS", "xyY", "ProPhoto", "YPbPr", "YCbCr", "Rec601YCbCr", "YCC", "Rec709YCbCr", "Log", "OHTA", "CMY", "YUV", "YIQ", "YDbDr", "Luv", "Oklch", "LCH", "LCHab", "LCHuv", "CIELab"].includes(image.magickColorspace ?? "");
    const counts = new IntegerTable(storage, 512), size = image.width * image.height * 4;
    const sampleOffsets = (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSI" || image.magickColorspace === "HWB" || image.magickColorspace === "LMS" || image.magickColorspace === "CAT02LMS" || image.magickColorspace === "XYZ" || image.magickColorspace === "DisplayP3" || image.magickColorspace === "xyY" || image.magickColorspace === "ProPhoto" || image.magickColorspace === "Jzazbz" || (image.magickColorspace === "YPbPr" || image.magickColorspace === "YCbCr") || image.magickColorspace === "Rec601YCbCr" || image.magickColorspace === "YCC" || image.magickColorspace === "Rec709YCbCr" || image.magickColorspace === "Log" || image.magickColorspace === "Adobe98" || image.magickColorspace === "OHTA" || image.magickColorspace === "CMY" || image.magickColorspace === "YUV" || image.magickColorspace === "YIQ" || image.magickColorspace === "YDbDr" || image.magickColorspace === "Oklab" || image.magickColorspace === "Luv" || image.magickColorspace === "Oklch" || image.magickColorspace === "LCH" || image.magickColorspace === "LCHab" || image.magickColorspace === "LCHuv" || image.magickColorspace === "CIELab") && image.storedHueSamples !== undefined ? new IntegerTable(storage, 128) : undefined;
    let unique = 0;
    for (let start = 0; start < size; start += 16384) {
        await yieldTurn(signal);
        const bytes = await storage.read(image.position + start, Math.min(16384, size - start));
        const original = image.storedData16 ? await storage.read(image.storedData16.position + start * 2, bytes.length * 2) : undefined;
        const data16 = original ? new Uint16Array(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)) : undefined;
        for (let offset = 0; offset < bytes.length; offset += 4) {
            const key = (data16 || hue) ? Array.from(data16?.subarray(offset, offset + 4) ?? bytes.subarray(offset, offset + 4), value => BigInt(data16 ? value : value * 257)).reduce((key, value) => (key << 16n) | value, 0n) : BigInt(((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0), count = await counts.get(key);
            if (count === undefined) {
                if (sampleOffsets) await sampleOffsets.set(key, BigInt(start + offset));
                unique++;
            }
            await counts.set(key, (count ?? 0n) + 1n);
        }
    }
    if (!hue) {
        let index = 0;
        for await (const [key, count] of counts.entries()) {
            if (index++ % 128 === 0) await yieldTurn(signal);
            yield histogramLine(image.storedData16 ? key : Number(key), Number(count), image.hasAlpha, (image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8)) > 8, precision) + "\n";
        }
        if (!unique) yield "\n";
        return;
    }
    let index = 0;
    for await (const [key, count] of counts.entries()) {
        if (index++ % 128 === 0) await yieldTurn(signal);
        const samples = sampleOffsets ? await storage.read(image.storedHueSamples! + Number(await sampleOffsets.get(key)) * 8, 32) : undefined;
        const hueSamples = samples ? Array.from(new Float64Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))) : undefined;
        yield (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp" || image.magickColorspace === "HSL" || image.magickColorspace === "HSB" || image.magickColorspace === "HSV" || image.magickColorspace === "HSI" || image.magickColorspace === "HWB" || image.magickColorspace === "LMS" || image.magickColorspace === "CAT02LMS" || image.magickColorspace === "XYZ" || image.magickColorspace === "DisplayP3" || image.magickColorspace === "xyY" || image.magickColorspace === "ProPhoto" || image.magickColorspace === "Jzazbz" || (image.magickColorspace === "YPbPr" || image.magickColorspace === "YCbCr") || image.magickColorspace === "Rec601YCbCr" || image.magickColorspace === "YCC" || image.magickColorspace === "Rec709YCbCr" || image.magickColorspace === "Log" || image.magickColorspace === "Adobe98" || image.magickColorspace === "OHTA" || image.magickColorspace === "CMY" || image.magickColorspace === "YUV" || image.magickColorspace === "YIQ" || image.magickColorspace === "YDbDr" || image.magickColorspace === "Oklab" || image.magickColorspace === "Luv" || image.magickColorspace === "Oklch" || image.magickColorspace === "LCH" || image.magickColorspace === "LCHab" || image.magickColorspace === "LCHuv" || image.magickColorspace === "CIELab") ? `  ${Number(count)}: ${hueTextPixel([48n, 32n, 16n, 0n].map(shift => Number((key >> shift) & 65535n)), image.hasAlpha, image.magickColorspace, hueSamples)}\n` : histogramLine(Number(key), Number(count), image.hasAlpha, false, precision) + "\n";
    }
    if (!unique) yield "\n";
}
export async function* encodeText(parts: AsyncIterable<string>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder(); let bytes = new Uint8Array(4096), used = 0, pending = "";
    for await (const next of parts) {
        let part = pending + next; pending = "";
        const last = part.charCodeAt(part.length - 1);
        if (last >= 0xd800 && last <= 0xdbff) { pending = part.at(-1)!; part = part.slice(0, -1); }
        signal.throwIfAborted();
        for (let offset = 0; offset < part.length;) {
            const { read, written } = encoder.encodeInto(part.slice(offset, offset + 4097), bytes.subarray(used));
            offset += read; used += written;
            if (used === bytes.length || read === 0) { yield bytes.subarray(0, used); bytes = new Uint8Array(4096); used = 0; }
        }
    }
    if (pending) {
        if (bytes.length - used < 3) { yield bytes.subarray(0, used); bytes = new Uint8Array(4096); used = 0; }
        used += encoder.encodeInto(pending, bytes.subarray(used)).written;
    }
    if (used) yield bytes.subarray(0, used);
}
