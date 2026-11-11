import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { HueMetadata } from "./colorspace-hue.js";

// ImageMagick's built-in threshold maps (thresholds.xml).
const maps: Record<string, { width: number; height: number; divisor: number; values: number[]; alias?: string }> = {
    threshold: { width: 1, height: 1, divisor: 2, alias: "1x1", values: [1] },
    checks: { width: 2, height: 2, divisor: 3, alias: "2x1", values: [1, 2, 2, 1] },
    o2x2: { width: 2, height: 2, divisor: 5, alias: "2x2", values: [1, 3, 4, 2] },
    o3x3: { width: 3, height: 3, divisor: 10, alias: "3x3", values: [3, 7, 4, 6, 1, 9, 2, 8, 5] },
    o4x4: { width: 4, height: 4, divisor: 17, alias: "4x4", values: [1, 9, 3, 11, 13, 5, 15, 7, 4, 12, 2, 10, 16, 8, 14, 6] },
    o8x8: { width: 8, height: 8, divisor: 65, alias: "8x8", values: [1, 49, 13, 61, 4, 52, 16, 64, 33, 17, 45, 29, 36, 20, 48, 32, 9, 57, 5, 53, 12, 60, 8, 56, 41, 25, 37, 21, 44, 28, 40, 24, 3, 51, 15, 63, 2, 50, 14, 62, 35, 19, 47, 31, 34, 18, 46, 30, 11, 59, 7, 55, 10, 58, 6, 54, 43, 27, 39, 23, 42, 26, 38, 22] },
    h4x4a: { width: 4, height: 4, divisor: 9, alias: "4x1", values: [4, 2, 7, 5, 3, 1, 8, 6, 7, 5, 4, 2, 8, 6, 3, 1] },
    h6x6a: { width: 6, height: 6, divisor: 19, alias: "6x1", values: [14, 13, 10, 8, 2, 3, 16, 18, 12, 7, 1, 4, 15, 17, 11, 9, 6, 5, 8, 2, 3, 14, 13, 10, 7, 1, 4, 16, 18, 12, 9, 6, 5, 15, 17, 11] },
    h8x8a: { width: 8, height: 8, divisor: 33, alias: "8x1", values: [13, 7, 8, 14, 17, 21, 22, 18, 6, 1, 3, 9, 28, 31, 29, 23, 5, 2, 4, 10, 27, 32, 30, 24, 16, 12, 11, 15, 20, 26, 25, 19, 17, 21, 22, 18, 13, 7, 8, 14, 28, 31, 29, 23, 6, 1, 3, 9, 27, 32, 30, 24, 5, 2, 4, 10, 20, 26, 25, 19, 16, 12, 11, 15] },
    h4x4o: { width: 4, height: 4, divisor: 17, values: [7, 13, 11, 4, 12, 16, 14, 8, 10, 15, 6, 2, 5, 9, 3, 1] },
    h6x6o: { width: 6, height: 6, divisor: 37, values: [7, 17, 27, 14, 9, 4, 21, 29, 33, 31, 18, 11, 24, 32, 36, 34, 25, 22, 19, 30, 35, 28, 20, 10, 8, 15, 26, 16, 6, 2, 5, 13, 23, 12, 3, 1] },
    h8x8o: { width: 8, height: 8, divisor: 65, values: [7, 21, 33, 43, 36, 19, 9, 4, 16, 27, 51, 55, 49, 29, 14, 11, 31, 47, 57, 61, 59, 45, 35, 23, 41, 53, 60, 64, 62, 52, 40, 38, 37, 44, 58, 63, 56, 46, 30, 22, 15, 28, 48, 54, 50, 26, 17, 10, 8, 18, 34, 42, 32, 20, 6, 2, 5, 13, 25, 39, 24, 12, 3, 1] },
    h16x16o: { width: 16, height: 16, divisor: 257, values: [4, 12, 24, 44, 72, 100, 136, 152, 150, 134, 98, 70, 42, 23, 11, 3, 7, 16, 32, 52, 76, 104, 144, 160, 158, 142, 102, 74, 50, 31, 15, 6, 19, 27, 40, 60, 92, 132, 168, 180, 178, 166, 130, 90, 58, 39, 26, 18, 36, 48, 56, 80, 124, 176, 188, 204, 203, 187, 175, 122, 79, 55, 47, 35, 64, 68, 84, 116, 164, 200, 212, 224, 223, 211, 199, 162, 114, 83, 67, 63, 88, 96, 112, 156, 192, 216, 232, 240, 239, 231, 214, 190, 154, 111, 95, 87, 108, 120, 148, 184, 208, 228, 244, 252, 251, 243, 226, 206, 182, 147, 119, 107, 128, 140, 172, 196, 219, 235, 247, 256, 255, 246, 234, 218, 194, 171, 139, 127, 126, 138, 170, 195, 220, 236, 248, 253, 254, 245, 233, 217, 193, 169, 137, 125, 106, 118, 146, 183, 207, 227, 242, 249, 250, 241, 225, 205, 181, 145, 117, 105, 86, 94, 110, 155, 191, 215, 229, 238, 237, 230, 213, 189, 153, 109, 93, 85, 62, 66, 82, 115, 163, 198, 210, 221, 222, 209, 197, 161, 113, 81, 65, 61, 34, 46, 54, 78, 123, 174, 186, 202, 201, 185, 173, 121, 77, 53, 45, 33, 20, 28, 37, 59, 91, 131, 167, 179, 177, 165, 129, 89, 57, 38, 25, 17, 8, 13, 29, 51, 75, 103, 143, 159, 157, 141, 101, 73, 49, 30, 14, 5, 1, 9, 21, 43, 71, 99, 135, 151, 149, 133, 97, 69, 41, 22, 10, 2] },
    c5x5b: { width: 5, height: 5, divisor: 26, alias: "c5x5", values: [1, 21, 16, 15, 4, 5, 17, 20, 19, 14, 6, 21, 25, 24, 12, 7, 18, 22, 23, 11, 2, 8, 9, 10, 3] },
    c5x5w: { width: 5, height: 5, divisor: 26, values: [25, 21, 10, 11, 22, 20, 9, 6, 7, 12, 19, 5, 1, 2, 13, 18, 8, 4, 3, 14, 24, 17, 16, 15, 23] },
    c6x6b: { width: 6, height: 6, divisor: 37, alias: "c6x6", values: [1, 5, 14, 13, 12, 4, 6, 22, 28, 27, 21, 11, 15, 29, 35, 34, 26, 20, 16, 30, 36, 33, 25, 19, 7, 23, 31, 32, 24, 10, 2, 8, 17, 18, 9, 3] },
    c6x6w: { width: 6, height: 6, divisor: 37, values: [36, 32, 23, 24, 25, 33, 31, 15, 9, 10, 16, 26, 22, 8, 2, 3, 11, 17, 21, 7, 1, 4, 12, 18, 30, 14, 6, 5, 13, 27, 35, 29, 20, 19, 28, 34] },
    c7x7b: { width: 7, height: 7, divisor: 50, alias: "c7x7", values: [3, 9, 18, 28, 17, 8, 2, 10, 24, 33, 39, 32, 23, 7, 19, 34, 44, 48, 43, 31, 16, 25, 40, 45, 49, 47, 38, 27, 20, 35, 41, 46, 42, 29, 15, 11, 21, 36, 37, 28, 22, 6, 4, 12, 13, 26, 14, 5, 1] },
    c7x7w: { width: 7, height: 7, divisor: 50, values: [47, 41, 32, 22, 33, 42, 48, 40, 26, 17, 11, 18, 27, 43, 31, 16, 6, 2, 7, 19, 34, 25, 10, 5, 1, 3, 12, 23, 30, 15, 9, 4, 8, 20, 35, 39, 29, 14, 13, 21, 28, 44, 46, 38, 37, 24, 36, 45, 49] },
};

export function parseOrderedDither(argument: string) {
    let position = 0;
    while (position < argument.length && (argument[position] === "," || argument[position]!.trim() === "")) position++;
    const start = position;
    while (position < argument.length && argument[position] !== "," && argument[position]!.trim() !== "") position++;
    const name = argument.slice(start, position).toLowerCase();
    const map = Object.entries(maps).find(([key, value]) => key === name || value.alias === name)?.[1];
    if (!map) throw new Error(`unsupported ordered-dither threshold map '${name}'`);
    const supplied: number[] = [];
    position = argument.indexOf(",", start) + 1;
    // Native only reads levels when a digit immediately follows the first comma.
    if (position > 0 && argument[position] !== undefined && "0123456789".includes(argument[position]!)) {
        const nextToken = (): string => {
            while (position < argument.length && argument[position]!.trim() === "") position++;
            const begin = position;
            if (argument[position] === ",") position++;
            else if (argument.slice(position, position + 2).toLowerCase() === "0x") {
                position += 2;
                while (position < argument.length && "0123456789abcdefABCDEF".includes(argument[position]!)) position++;
                if (argument[position] === "%") position++;
            } else if (Number.isFinite(Number.parseFloat(argument.slice(position)))) {
                if (argument[position] === "+" || argument[position] === "-") position++;
                while (position < argument.length && "0123456789".includes(argument[position]!)) position++;
                if (argument[position] === ".") position++;
                while (position < argument.length && "0123456789".includes(argument[position]!)) position++;
                if (argument[position] === "e" || argument[position] === "E") {
                    let exponent = position + 1;
                    if (argument[exponent] === "+" || argument[exponent] === "-") exponent++;
                    const digits = exponent;
                    while (exponent < argument.length && "0123456789".includes(argument[exponent]!)) exponent++;
                    if (exponent > digits) position = exponent;
                }
                if (argument[position] === "%") position++;
            } else {
                while (position < argument.length && argument[position] !== "," && argument[position]!.trim() !== "") position++;
            }
            const token = argument.slice(begin, position);
            while (position < argument.length && argument[position]!.trim() === "") position++;
            return token;
        };
        do {
            let token = nextToken();
            if (token === ",") token = nextToken();
            supplied.push(token.toLowerCase().startsWith("0x") ? Number.parseInt(token, 16) : Number.parseFloat(token) || 0);
        } while (position < argument.length && supplied.length < 6);
    }
    if (supplied.some(value => !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / map.divisor))
        throw new Error(`invalid ordered-dither levels '${argument}'`);
    // Native uses the first count as a default, then overrides channels with
    // subsequent counts, in selected-channel order. Zero and one leave it alone.
    const levels = Array.from({ length: 5 }, (_, channel) => {
        const value = supplied[channel + 1] ?? supplied[0] ?? 2;
        return value >= 1 ? value - 1 : value;
    });
    const defaultCount = supplied[0] ?? 2;
    return { map, levels, defaultLevel: defaultCount >= 1 ? defaultCount - 1 : defaultCount };
}

// Extra planes follow the selected color and alpha channels in level-count order.
export function* orderedDitherMetaOptions(image: Pick<RgbaImage, "space" | "hasAlpha"> & { alphaSeparate?: boolean | undefined; alphaBlend?: boolean | undefined }, options: ReturnType<typeof parseOrderedDither>, channels: readonly (boolean | undefined)[], meta: "all" | readonly number[], count: number) {
    const gray = image.space === "b-w" || image.space === "grey16";
    let selected = Number(!!channels[0]) + Number(!gray && !!channels[1]) + Number(!gray && !!channels[2])
        + Number(image.space === "cmyk" && !!channels[4])
        + Number(!!channels[3] && !!(image.hasAlpha || image.alphaSeparate === true && image.alphaBlend !== false));
    for (let index = 0; index < count; index++) {
        if (meta !== "all" && !meta.includes(index)) continue;
        const level = options.levels[selected++] ?? options.defaultLevel;
        const planeOptions = { ...options, levels: [level, level, level] };
        yield [index, planeOptions] as const;
    }
}

export function* orderedDitherPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "space"> & Partial<Pick<StoredRgbaImage, "storedData16">> & HueMetadata & { alphaSeparate?: boolean | undefined; alphaBlend?: boolean | undefined }, { map, levels }: ReturnType<typeof parseOrderedDither>, channels: readonly (boolean | undefined)[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const cmyk = image.space === "cmyk";
    const gray = image.space === "b-w" || image.space === "grey16";
    const highDepth = !!(image.data16 || image.storedData16), maximum = highDepth ? 65535 : 255;
    for (let y = 0; y < image.height; y++) for (let left = 0; left < image.width; left += 1024) {
        yield;
        const count = Math.min(1024, image.width - left), position = (y * image.width + left) * 4;
        const input = (yield { kind: "read", highDepth, position, length: count * 4 })!;
        const bytes = new Uint8Array(input);
        const data = highDepth ? new Uint16Array(bytes.buffer) : bytes;
        const hueBytes = (cmyk || image.magickColorspace) && (image.hueSamples || image.storedHueSamples !== undefined)
            ? (yield { kind: "read", hue: true, position, length: count * 4 })! : undefined;
        const hue = hueBytes ? new Float64Array(new Uint8Array(hueBytes).buffer) : undefined;
        const floats = (yield { kind: "read", evaluate: true, position, length: count * 4 })!;
        const samples = floats.length ? new Float64Array(floats.slice().buffer) : Float64Array.from(data, value => value * 255 / maximum);
        for (let x = 0; x < count; x++) {
            const threshold = map.values[(y % map.height) * map.width + (left + x) % map.width]!;
            let selected = 0;
            // CMYK visits black before alpha; alpha remains in the RGBA backing.
            for (let channel = 0; channel < (cmyk ? 5 : 4); channel++) {
                const alpha = channel === (cmyk ? 4 : 3);
                const offset = x * 4 + (alpha ? 3 : channel);
                if (!channels[cmyk && channel === 3 ? 4 : alpha ? 3 : channel] || (alpha && !(image.hasAlpha || image.alphaSeparate === true && image.alphaBlend !== false)) || (gray && (channel === 1 || channel === 2))) continue;
                const intervals = levels[selected++]!;
                if (intervals === 0) continue;
                const working = hue && !(cmyk && alpha);
                const sample = working ? Math.max(0, Math.min(1, hue[offset]!)) : samples[offset]! / 255;
                // Native signed integer conversion and division truncate toward zero.
                const scaled = Math.trunc(sample * (intervals * (map.divisor - 1) + 1));
                const level = Math.trunc(scaled / (map.divisor - 1)) + (scaled % (map.divisor - 1) >= threshold ? 1 : 0);
                // Native HDRI keeps fractional and over-range Q16 levels until encoding.
                const value = Math.fround(level * 65535 / intervals);
                if (working) hue[offset] = cmyk ? value / 65535 : Math.min(1, level / intervals);
                if (!cmyk || alpha) {
                    samples[offset] = value / 257;
                    data[offset] = Math.round(Math.max(0, Math.min(maximum, samples[offset]! * maximum / 255)));
                }
                if (gray && channel === 0) {
                    data[x * 4 + 1] = data[x * 4 + 2] = data[x * 4]!;
                    samples[x * 4 + 1] = samples[x * 4 + 2] = samples[x * 4]!;
                }
            }
            if (cmyk && hue) for (let channel = 0; channel < 3; channel++) {
                const offset = x * 4 + channel;
                samples[offset] = Math.fround((1 - hue[offset]!) * (1 - hue[x * 4 + 3]!) * 65535) / 257;
                data[offset] = Math.round(samples[offset]! * maximum / 255);
            }
        }
        yield { kind: "write", highDepth, position, data: bytes };
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(hue.buffer) };
    }
}
