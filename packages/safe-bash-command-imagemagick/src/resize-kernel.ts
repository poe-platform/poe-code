import { rgbToCmyk } from "./colorspace-cmyk.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import type { ResizeKernel, RgbaColor } from "@poe-code/image-ast/portable";
import { interpolatePixelSteps } from "./sequence-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export type MagickResizeKernel = ResizeKernel | "gaussian" | "jinc" | "lagrange" | "sinc" | "sincfast" | "magickernelsharp2013" | "magickernelsharp2021" | "lanczos2sharp" | "lanczossharp" | "box" | "catrom" | "cubicspline" | "hermite" | "quadratic" | "robidoux" | "robidouxsharp" | "bartlett" | "blackman" | "bohman" | "cosine" | "hamming" | "hann" | "kaiser" | "parzen" | "welch";

export type ResizeFilterSettings = { blur?: number; support?: number; lobes?: number; b?: number; c?: number; sigma?: number; window?: MagickResizeKernel };

export function* adaptiveResizePixelSteps(image: { width: number; height: number; hasAlpha: boolean; space?: string; hueSamples?: Float64Array; storedHueSamples?: number }, width: number, height: number, highDepth: boolean, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge", mask = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const maximum = highDepth ? 65535 : 255;
    const cmyk = image.space === "cmyk";
    const hue = !cmyk && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const gray = virtualPixel === "white" ? maximum : virtualPixel === "gray" ? highDepth ? 32768 : 128 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile")
        ? [background.r, background.g, background.b, background.a].map(value => value * (highDepth ? 257 : 1))
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : maximum];
    for (let start = 0; start < width * height; start += 256) {
        yield;
        const count = Math.min(256, width * height - start);
        const data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const samples = new Float64Array(count * 4);
        const inks = cmyk && !mask ? new Float64Array(count * 4) : undefined;
        const hueSamples = hue && !mask ? new Float64Array(count * 4) : undefined;
        for (let offset = 0; offset < count; offset++) {
            const x = ((start + offset) % width + 0.5) * image.width / width - 0.5;
            const y = (Math.floor((start + offset) / width) + 0.5) * image.height / height - 0.5;
            const left = Math.floor(x), top = Math.floor(y), dx = x - left, dy = y - top;
            const pixels: ArrayLike<number>[] = [];
            const coverage: number[] = [];
            for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
                const position = virtualPixelIndex(left + column, top + row, image.width, image.height, virtualPixel) * 4;
                if (position < 0) {
                    if (cmyk) {
                        const ink = rgbToCmyk(fill[0]! / maximum, fill[1]! / maximum, fill[2]! / maximum);
                        pixels.push([ink[0]! * maximum, ink[1]! * maximum, ink[2]! * maximum, fill[3]!, ink[3]! * maximum]);
                    } else pixels.push(fill);
                    if (mask) coverage.push(0);
                    continue;
                }
                const retained = yield { kind: "read", evaluate: true, position, length: 4 };
                let pixel: Uint8Array | Uint16Array | Float64Array;
                if (retained?.length) {
                    const values = new Float64Array(retained.slice().buffer);
                    pixel = highDepth ? values.map(value => value * 257) : values;
                } else {
                    const bytes = (yield { kind: "read", highDepth, position, length: 4 })!;
                    pixel = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
                }
                if (cmyk) {
                    const hue = yield { kind: "read", hue: true, position, length: 4 };
                    const ink = hue?.length ? new Float64Array(hue.slice().buffer) : rgbToCmyk(pixel[0]! / maximum, pixel[1]! / maximum, pixel[2]! / maximum);
                    pixels.push([ink[0]! * maximum, ink[1]! * maximum, ink[2]! * maximum, pixel[3]!, ink[3]! * maximum]);
                } else if (hue) {
                    const bytes = (yield { kind: "read", hue: true, position, length: 4 })!;
                    pixels.push(new Float64Array(bytes.slice().buffer).map(value => value * maximum));
                } else pixels.push(pixel);
                if (mask) {
                    const working = yield { kind: "read", evaluate: true, image: 1, position, length: 4 };
                    const samples = working?.length ? new Float64Array(working.slice().buffer)
                        : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: 1, position, length: 4 })!.slice().buffer), value => value / 257);
                    coverage.push(0.212656 * samples[0]! + 0.715158 * samples[1]! + 0.072186 * samples[2]!);
                }
            }
            const luma = pixels.map(p => 0.212656 * p[0]! + 0.715158 * p[1]! + 0.072186 * p[2]!);
            // Choose the diagonal with the smaller luma difference, then its enclosing triangle.
            const weights = Math.abs(luma[0]! - luma[3]!) < Math.abs(luma[1]! - luma[2]!)
                ? dx <= dy ? [1 - dy, 0, dy - dx, dx] : [1 - dx, dx - dy, 0, dy]
                : dx <= 1 - dy ? [1 - dx - dy, dx, dy, 0] : [0, 1 - dy, 1 - dx, dx + dy - 1];
            const alpha = pixels.reduce((sum, p, i) => sum + p[3]! * weights[i]!, 0);
            for (let channel = 0; channel < (cmyk && !mask ? 5 : 4); channel++) {
                // Native mesh divides unassociated colors by interpolated alpha.
                // Masks follow the source image's mesh, without alpha weighting.
                const value = mask ? channel === 3 ? maximum : coverage.reduce((sum, value, i) => sum + value * weights[i]!, 0) * maximum / 255
                    : channel === 3 ? alpha : pixels.reduce((sum, p, i) => sum + p[channel]! * weights[i]!, 0)
                        / (image.hasAlpha ? Math.max(1e-12, alpha / maximum) : 1);
                const scale = highDepth ? 1 : 257;
                if (hueSamples) hueSamples[offset * 4 + channel] = Math.fround(value * scale) / 65535;
                if (!cmyk || mask || channel === 3) samples[offset * 4 + channel] = Math.fround(value * scale) / 257;
                if (inks && channel !== 3) inks[offset * 4 + (channel === 4 ? 3 : channel)] = Math.fround(value * scale) / (maximum * scale);
                else data[offset * 4 + channel] = Math.max(0, Math.min(maximum, Math.round(Math.fround(value * scale) / scale)));
            }
        }
        if (inks) {
            for (let offset = 0; offset < count * 4; offset += 4) for (let channel = 0; channel < 3; channel++) {
                samples[offset + channel] = (1 - inks[offset + channel]!) * (1 - inks[offset + 3]!) * 255;
                data[offset + channel] = Math.round(samples[offset + channel]! * maximum / 255);
            }
            yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(inks.buffer) };
        }
        if (hueSamples) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(hueSamples.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(samples.buffer) };
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer) };
    }
}

function sinc(x: number): number {
    return Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

// J1(pi*x)/x, evaluated on Jinc's bounded three-lobe support (x <= 3.239).
function jinc(x: number): number {
    const squared = (Math.PI * x / 2) ** 2;
    let term = Math.PI / 2, sum = term;
    for (let k = 1; k <= 32; k++) {
        term *= -squared / (k * (k + 1));
        sum += term;
    }
    return sum;
}

// Modified Bessel I0 for Kaiser's fixed beta (6.5), bounded to double precision.
function besselI0(x: number): number {
    let sum = 1, term = 1;
    for (let k = 1; k <= 24; k++) {
        term *= x * x / (4 * k * k);
        sum += term;
    }
    return sum;
}

function windowWeight(kernel: MagickResizeKernel, x: number): number {
    switch (kernel) {
        case "box": return 1;
        case "bartlett": return 1 - x;
        case "blackman": {
            const cosine = Math.cos(Math.PI * x);
            return 0.34 + cosine * (0.5 + 0.16 * cosine);
        }
        case "bohman": return (1 - x) * Math.cos(Math.PI * x) + Math.sin(Math.PI * x) / Math.PI;
        case "cosine": return Math.cos(Math.PI * x / 2);
        case "hamming": return 0.54 + 0.46 * Math.cos(Math.PI * x);
        case "hann": return 0.5 + 0.5 * Math.cos(Math.PI * x);
        case "kaiser": return besselI0(6.5 * Math.sqrt(Math.max(0, 1 - x * x))) / besselI0(6.5);
        case "parzen": return x < 0.5 ? 2 / 3 - 4 * x * x + 4 * x * x * x : 4 / 3 * (1 - x) ** 3;
        case "welch": return 1 - x * x;
        default: return sinc(x);
    }
}

export function resizeFilter(kernel: MagickResizeKernel, settings: ResizeFilterSettings = {}, radial = false) {
    // ImageMagick promotes windowed Sinc to Jinc for radial (EWA) sampling.
    const windowedJinc = radial && (settings.window !== undefined || ["lanczos2", "lanczos2sharp", "lanczos3", "lanczossharp", "bartlett", "blackman", "bohman", "cosine", "hamming", "hann", "kaiser", "parzen", "welch"].includes(kernel));
    const lobes = settings.lobes ?? (kernel === "lanczos2" || kernel === "lanczos2sharp" ? 2 : 3);
    const jincSupport = (kernel === "jinc" || windowedJinc) ? [1.2196698912665045,2.2331305943815285,3.238315484166236,4.24106286379607,5.242764376870182,6.243921689864488,7.244759868719957,8.245394913952042,9.245892684949467,10.246293348754916,11.246622794877883,12.246898461138105,13.247132522181062,14.24733373580685,15.2475085630373,16.247661874700963][Math.min(16, lobes) - 1] : undefined;
    const radius = settings.support ?? jincSupport ?? settings.lobes ?? (kernel === "box" ? radial ? Math.SQRT1_2 : 0.5 : kernel === "jinc" ? 3.238315484166236 : kernel === "magickernelsharp2013" ? 2.5 : kernel === "magickernelsharp2021" ? 4.5
        : kernel === "gaussian" ? 4 * (radial ? Math.max(0.5, settings.sigma ?? 0.5) : settings.sigma ?? 0.5) : kernel === "lagrange" ? 2 : kernel === "linear" || kernel === "bilinear" || kernel === "hermite" ? 1 : kernel === "quadratic" ? 1.5 : kernel === "cubic" || kernel === "catrom" || kernel === "cubicspline" || kernel === "robidoux" || kernel === "robidouxsharp" || kernel === "mitchell" || kernel === "lanczos2" || kernel === "lanczos2sharp" ? 2
        : kernel === "lanczos3" || kernel === "lanczossharp" || kernel === "cosine" || kernel === "welch" ? 3 : 4);
    // ImageMagick BC cubic parameters; Cubic/Spline use the B-spline, Catrom interpolates.
    const b = settings.b ?? (settings.c !== undefined ? 1 - 2 * settings.c : kernel === "mitchell" ? 1 / 3 : kernel === "cubic" ? 1 : kernel === "robidoux" ? 0.3782157550939987 : kernel === "robidouxsharp" ? 0.2620145123990142 : 0);
    const c = settings.c ?? (settings.b !== undefined ? (1 - settings.b) / 2 : kernel === "mitchell" ? 1 / 3 : kernel === "catrom" ? 0.5 : kernel === "robidoux" ? 0.3108921224530007 : kernel === "robidouxsharp" ? 0.3689927438004929 : 0);
    return { radius, weight(x: number) {
        let weight = kernel === "box" ? 1
            : windowedJinc ? jinc(x) * (settings.window ? windowWeight(settings.window, x / radius)
                : kernel === "lanczos2" || kernel === "lanczos2sharp" || kernel === "lanczos3" || kernel === "lanczossharp" ? jinc(x * 1.2196698912665045 / radius) : windowWeight(kernel, x / radius))
            : ((kernel === "mitchell" || kernel === "cubic" || kernel === "catrom" || kernel === "robidoux" || kernel === "robidouxsharp" || kernel === "cubicspline") && x >= 2) || (kernel === "hermite" && x >= 1) || (kernel === "quadratic" && x >= 1.5) ? 0
            : kernel === "gaussian" ? Math.exp(-x * x / (2 * (settings.sigma ?? 0.5) ** 2))
            : kernel === "jinc" ? jinc(x)
            : kernel === "sinc" || kernel === "sincfast" ? sinc(x)
            : kernel === "lagrange" ? (x < 1 ? (x + 1) * (x - 1) * (x - 2) / 2 : -(x - 1) * (x - 2) * (x - 3) / 6)
            : kernel === "magickernelsharp2013" ? (x < 0.5 ? 0.625 + 1.75 * (0.5 - x) * (0.5 + x)
                : x < 1.5 ? (1 - x) * (1.75 - x) : -0.125 * (2.5 - x) ** 2)
            : kernel === "magickernelsharp2021" ? (x < 0.5 ? 577 / 576 - 239 / 144 * x * x
                : x < 1.5 ? 35 / 36 * (x - 1) * (x - 239 / 140)
                : x < 2.5 ? (x - 2) * (65 / 24 - x) / 6
                : x < 3.5 ? (x - 3) * (x - 3.75) / 36 : -((x - 4.5) ** 2) / 288)
            : kernel === "linear" || kernel === "bilinear" ? Math.max(0, 1 - x)
            : kernel === "hermite" ? (2 * x - 3) * x * x + 1
            : kernel === "quadratic" ? (x < 0.5 ? 0.75 - x * x : 0.5 * (x - 1.5) ** 2)
            : kernel === "cubicspline" ? (x < 1 ? ((x - 9 / 5) * x - 1 / 5) * x + 1 : ((-(x - 1) / 3 + 4 / 5) * (x - 1) - 7 / 15) * (x - 1))
            : kernel === "mitchell" || kernel === "cubic" || kernel === "catrom" || kernel === "robidoux" || kernel === "robidouxsharp"
                ? (x < 1 ? ((12 - 9 * b - 6 * c) * x ** 3 + (-18 + 12 * b + 6 * c) * x * x + 6 - 2 * b) / 6
                    : ((-b - 6 * c) * x ** 3 + (6 * b + 30 * c) * x * x + (-12 * b - 48 * c) * x + 8 * b + 24 * c) / 6)
            : sinc(x) * windowWeight(settings.window ?? kernel, x / radius);
        if (!windowedJinc && settings.window && kernel === "sinc") weight *= windowWeight(settings.window, x / radius);
        return weight;
    } };
}

function contributions(index: number, source: number, target: number, blur: number, area: boolean, kernel: MagickResizeKernel, thumbnailFactor = 0, settings: ResizeFilterSettings = {}) {
    if (thumbnailFactor >= 3) {
        // ThumbnailImage samples to 4x, box-filters to 2x, then applies the final
        // filter. Compose the weights to retain HDRI precision without temporary rasters.
        const sampled = thumbnailFactor >= 5 ? 4 * target : source;
        const filtered = contributions(index, 2 * target, target, blur, false, kernel, 0, settings);
        const boxes = Array.from(filtered.weights, (_, i) => {
            const center = (filtered.first + i + 0.5) * sampled / (2 * target);
            const support = sampled / (4 * target);
            return { first: Math.max(0, Math.floor(center - support + 0.5 + 1e-12)),
                end: Math.min(sampled, Math.floor(center + support + 0.5 + 1e-12)) };
        });
        const sourceIndex = (i: number) => Math.floor((i + 0.5 - 1e-12) * source / sampled);
        const first = sourceIndex(boxes[0]!.first), last = sourceIndex(boxes[boxes.length - 1]!.end - 1);
        const weights = new Float64Array(last - first + 1);
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i]!;
            for (let j = box.first; j < box.end; j++) weights[sourceIndex(j) - first]! += filtered.weights[i]! / (box.end - box.first);
        }
        return { first, weights };
    }
    if (area) {
        const start = index * source, end = (index + 1) * source;
        const first = Math.floor(start / target), last = Math.ceil(end / target) - 1;
        const weights = Float64Array.from({ length: last - first + 1 }, (_, i) =>
            (Math.min(end, (first + i + 1) * target) - Math.max(start, (first + i) * target)) / source);
        return { first, weights };
    }
    if (kernel === "nearest") return { first: Math.min(source - 1, Math.floor((index + 0.5) * source / target)), weights: Float64Array.of(1) };
    if (kernel === "box") {
        const center = (index + 0.5) * source / target;
        const support = Math.max(0.5, Math.max(1, source / target) * blur * (settings.support ?? settings.lobes ?? 0.5));
        const first = Math.max(0, Math.floor(center - support + 0.5 + 1e-12));
        const end = Math.min(source, Math.floor(center + support + 0.5 + 1e-12));
        return { first, weights: new Float64Array(end - first).fill(1 / (end - first)) };
    }
    const { radius, weight } = resizeFilter(kernel, settings);
    // Native support includes MagickEpsilon, retaining boundary taps at unit scale.
    let scale = Math.max(1, source / target + 1e-12) * blur;
    const narrow = radius * scale < 0.5;
    // Native filter bisectors include MagickEpsilon, even at half-sample ties.
    const center = (index + 0.5) * source / target + 1e-12 - 0.5;
    if (narrow) scale = blur;
    const support = Math.max(0.5, radius * scale);
    const first = Math.max(0, Math.ceil(center - support)), last = Math.min(source - 1, Math.floor(center + support));
    const weights = new Float64Array(last - first + 1);
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
        const distance = (first + i - center) / scale;
        const x = Math.abs(distance);
        weights[i] = weight(x);
        sum += weights[i]!;
    }
    const density = 1 / (Math.abs(sum) >= 1e-12 ? sum : sum < 0 ? -1e-12 : 1e-12);
    for (let i = 0; i < weights.length; i++) weights[i]! *= density;
    return { first, weights };
}

type ResizeImage = { width: number; height: number; hasAlpha: boolean; inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined; alphaSeparate?: boolean | undefined; space?: string; magickColorspace?: string };
type ResizeSamples = Generator<ConvolveRequest | { kind: "samples"; position: number; data: Float64Array } | undefined, void, Uint8Array | undefined>;

/** Keep HDRI samples unclamped until all resizing and morph blending is finished. */
function* resizeSamples(image: ResizeImage, width: number, height: number, thumbnail: boolean, scale: boolean, kernel: MagickResizeKernel, highDepth = false, settings: ResizeFilterSettings = {}, inks = false, preserveSamples = false, axis?: "horizontal" | "vertical"): ResizeSamples {
    // An explicit window selects the Sinc weighting function with four-lobe support.
    if (settings.window) kernel = "sinc";
    // Working CMYK rows use C, M, Y, alpha, K; black is never an alpha weight.
    const range = highDepth ? 65535 : 255, stride = inks ? 5 : 4;
    const hue = !!image.magickColorspace && image.magickColorspace !== "RGB" && image.magickColorspace !== "Gray";
    // Four Float64 samples per pixel must fit in a 16 KiB storage read.
    const readPixels = hue || preserveSamples || inks ? 512 : 1024;
    // ImageMagick sharpens the sinc window by narrowing its support.
    const blur = Math.max(1e-12, (settings.blur ?? 1) * (kernel === "lanczos2sharp" ? 0.9549963639785485
        : kernel === "lanczossharp" ? 0.9812505644269356 : 1));
    const thumbnailFactor = thumbnail ? Math.floor(Math.min(image.width / width, image.height / height)) : 0;
    for (let left = 0; left < width; left += 256) {
        const count = Math.min(256, width - left), horizontal = Array.from({ length: count }, (_, x) => axis === "vertical" ? { first: left + x, weights: [1] } : contributions(left + x, image.width, width, blur, scale, kernel, thumbnailFactor, settings));
        const rows = new Map<number, Float64Array>();
        for (let y = 0; y < height; y++) {
            yield;
            const vertical = axis === "horizontal" ? { first: y, weights: [1] } : contributions(y, image.height, height, blur, scale, kernel, thumbnailFactor, settings), sums = new Float64Array(count * stride);
            for (let k = 0; k < vertical.weights.length; k++) {
                const sy = vertical.first + k;
                let row = rows.get(sy);
                if (!row) {
                    yield;
                    row = new Float64Array(count * stride);
                    const first = horizontal[0]!.first, last = horizontal[count - 1]!;
                    const end = last.first + last.weights.length;
                    for (let start = first; start < end; start += readPixels) {
                        if (start > first) yield;
                        const length = Math.min(readPixels, end - start);
                        const position = (sy * image.width + start) * 4;
                        const samples = hue || preserveSamples ? yield { kind: "read", hue, evaluate: !hue, position, length: length * 4 } : undefined;
                        let pixels: Uint8Array | Uint16Array | Float64Array;
                        if (samples?.length) {
                            pixels = new Float64Array(samples.slice().buffer);
                            // Native HDRI channels are float quantum values before filtering.
                            if (hue || highDepth) pixels = pixels.map(value => Math.fround(value * (hue ? 65535 : 257)) / (highDepth ? 1 : 257));
                        } else {
                            const bytes = yield { kind: "read", highDepth, position, length: length * 4 };
                            if (!bytes || bytes.length !== length * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated resize pixels");
                            pixels = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
                        }
                        let cmyk: Float64Array | undefined;
                        if (inks && image.space === "cmyk") {
                            const bytes = yield { kind: "read", hue: true, position: (sy * image.width + start) * 4, length: length * 4 };
                            if (bytes?.length) cmyk = new Float64Array(bytes.slice().buffer);
                            else {
                                cmyk = new Float64Array(length * 4);
                                for (let i = 0; i < length; i++) cmyk.set(rgbToCmyk(pixels[i * 4]! / range, pixels[i * 4 + 1]! / range, pixels[i * 4 + 2]! / range), i * 4);
                            }
                        }
                        for (let x = 0; x < count; x++) {
                            const contribution = horizontal[x]!;
                            for (let sx = Math.max(start, contribution.first); sx < Math.min(start + length, contribution.first + contribution.weights.length); sx++) {
                                const i = sx - start, weight = contribution.weights[sx - contribution.first]!;
                                const alpha = image.hasAlpha ? pixels[i * 4 + 3]! / range : 1;
                                for (let channel = 0; channel < stride; channel++) {
                                    if (channel === 3) continue;
                                    const value = cmyk ? cmyk[i * 4 + (channel === 4 ? 3 : channel)]! * range : channel === 4 ? 0 : pixels[i * 4 + channel]!;
                                    row[x * stride + channel]! += value * alpha * weight;
                                }
                                row[x * stride + 3]! += alpha * weight;
                            }
                        }
                    }
                    // ResizeImage stores the first axis in float quantum samples
                    // before filtering the second axis.
                    if (!scale && !axis && thumbnailFactor < 3 && width / image.width > height / image.height) {
                        const quantum = highDepth ? 1 : 257;
                        for (let x = 0; x < count; x++) {
                            const alpha = row[x * stride + 3]!;
                            const storedAlpha = image.hasAlpha ? Math.fround(alpha * 65535) / 65535 : 1;
                            for (let channel = 0; channel < stride; channel++) if (channel !== 3) {
                                const value = row[x * stride + channel]! / (image.hasAlpha ? Math.abs(alpha) < 1e-12 ? 1e-12 : alpha : 1);
                                row[x * stride + channel] = Math.fround(value * quantum) / quantum * storedAlpha;
                            }
                            row[x * stride + 3] = storedAlpha;
                        }
                    }
                    if (rows.size === 64) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let i = 0; i < sums.length; i++) sums[i]! += row[i]! * vertical.weights[k]!;
            }
            for (let x = 0; x < count; x++) {
                const alpha = sums[x * stride + 3]!;
                for (let channel = 0; channel < stride; channel++) if (channel !== 3) sums[x * stride + channel] = !image.hasAlpha ? sums[x * stride + channel]! : Math.abs(alpha) < 1e-12 ? 0 : sums[x * stride + channel]! / alpha;
                sums[x * stride + 3] = image.hasAlpha ? alpha * range : range;
            }
            yield { kind: "samples", position: (y * width + left) * 4, data: sums };
        }
    }
}

// ResizeImage's copied channels round the filter bisector, rather than the
// pixel-center coordinate used by SampleImage and ordinary Point filtering.
function resizeCopyIndex(index: number, source: number, target: number) {
    return Math.min(source - 1, Math.floor((index + 0.5) * source / target + 0.5 + 1e-12));
}

export function* resizeMaskPixelSteps(image: ResizeImage, width: number, height: number, horizontal?: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 256) {
        yield;
        const data = new Uint16Array(Math.min(256, width - left) * 4);
        for (let x = left; x < left + data.length / 4; x++) {
            const sx = horizontal !== false ? resizeCopyIndex(x, image.width, width) : x;
            const sy = horizontal === true ? y : resizeCopyIndex(y, image.height, height);
            const bytes = (yield { kind: "read", highDepth: true, position: (sy * image.width + sx) * 4, length: 4 })!;
            data.set(new Uint16Array(bytes.slice().buffer), (x - left) * 4);
        }
        yield { kind: "write", highDepth: true, position: (y * width + left) * 4, data: new Uint8Array(data.buffer) };
    }
}

export function* resizePixelSteps(image: ResizeImage, width: number, height: number, thumbnail: boolean, scale = false, kernel: MagickResizeKernel = "lanczos3", highDepth = false, settings?: ResizeFilterSettings, preserveSamples = false, writeMask = false, axis?: "horizontal" | "vertical", channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    if (scale && writeMask) {
        // ScaleImage checks the resized clone's zero write-mask channel before
        // writing area averages, leaving its color and active alpha channels zero.
        for (let start = 0; start < width * height; start += 1024) {
            yield;
            const count = Math.min(1024, width * height - start);
            const data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
            if (!image.hasAlpha) for (let i = 3; i < data.length; i += 4) data[i] = highDepth ? 65535 : 255;
            yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer) };
        }
        return;
    }
    const cmyk = image.space === "cmyk", stride = cmyk ? 5 : 4;
    const inactiveAlpha = thumbnail && !image.hasAlpha && image.inactiveAlpha;
    // Deactivation retains RGB blending; disassociation retains unclamped colors.
    const samples = resizeSamples(inactiveAlpha ? { ...image, hasAlpha: image.alphaBlend === true } : image, width, height, thumbnail, scale, kernel, highDepth, settings, cmyk, preserveSamples || !!inactiveAlpha, axis);
    const range = highDepth ? 65535 : 255;
    let next = samples.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind !== "samples") { next = samples.next(yield request); continue; }
        // Inactive alpha is copied unless discrete alpha still updates it.
        // Disassociation leaves an undefined channel in the resized clone.
        if (inactiveAlpha && !(image.alphaSeparate && image.alphaBlend)) {
            for (let i = 0; i < request.data.length; i += stride) {
                if (image.alphaSeparate) { request.data[i + 3] = 0; continue; }
                const pixel = request.position / 4 + i / stride;
                const sx = resizeCopyIndex(pixel % width, image.width, width);
                const sy = resizeCopyIndex(Math.floor(pixel / width), image.height, height);
                const position = (sy * image.width + sx) * 4;
                const samples = yield { kind: "read", evaluate: true, position, length: 4 };
                const bytes = samples?.length ? samples : (yield { kind: "read", highDepth, position, length: 4 })!;
                const values = samples?.length ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
                request.data[i + 3] = values[3]! * (samples?.length && highDepth ? 257 : 1);
            }
        }
        if (axis) {
            const horizontal = axis === "horizontal";
            for (let i = 0; i < request.data.length; i += stride) {
                const pixel = request.position / 4 + i / stride, x = pixel % width, y = Math.floor(pixel / width);
                const sx = horizontal ? resizeCopyIndex(x, image.width, width) : x;
                const sy = horizontal ? y : resizeCopyIndex(y, image.height, height);
                // The authentic row/column cache starts with a zero mask and
                // retains the copied mask from the preceding row/column.
                let mask = writeMask ? 0 : 65535;
                if (writeMask && (horizontal ? x > 0 : y > 0)) {
                    const mx = horizontal ? resizeCopyIndex(x - 1, image.width, width) : x;
                    const my = horizontal ? y : resizeCopyIndex(y - 1, image.height, height);
                    const bytes = (yield { kind: "read", image: 1, highDepth: true, position: (my * image.width + mx) * 4, length: 4 })!;
                    const pixels = new Uint16Array(bytes.slice().buffer);
                    mask = 0.212656 * pixels[0]! + 0.715158 * pixels[1]! + 0.072186 * pixels[2]!;
                }
                if (mask <= 65535 / 2 || channels) {
                    const position = (sy * image.width + sx) * 4;
                    const hue = !cmyk && !!image.magickColorspace && image.magickColorspace !== "RGB" && image.magickColorspace !== "Gray";
                    const samples = yield { kind: "read", hue, evaluate: !hue, position, length: 4 };
                    const bytes = samples?.length ? samples : (yield { kind: "read", highDepth, position, length: 4 })!;
                    const values = samples?.length ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
                    for (let c = 0; c < 4; c++) if (mask <= 65535 / 2 || channels?.[c] === false)
                        request.data[i + c] = values[c]! * (samples?.length ? hue ? range : highDepth ? 257 : 1 : 1);
                    if (cmyk) {
                        const bytes = yield { kind: "read", hue: true, position, length: 4 };
                        const inks = bytes?.length ? new Float64Array(bytes.slice().buffer)
                            : rgbToCmyk(request.data[i]! / range, request.data[i + 1]! / range, request.data[i + 2]! / range);
                        for (let c = 0; c < 4; c++) if (mask <= 65535 / 2 || channels?.[c === 3 ? 4 : c] === false)
                            request.data[i + (c === 3 ? 4 : c)] = inks[c]! * range;
                    }
                }
            }
        }
        if (cmyk) {
            const count = request.data.length / stride, inks = new Float64Array(count * 4), pixels = new Float64Array(count * 4);
            for (let i = 0; i < count; i++) {
                for (let c = 0; c < 4; c++) inks[i * 4 + c] = Math.fround(request.data[i * stride + (c === 3 ? 4 : c)]! * (highDepth ? 1 : 257)) / 65535;
                for (let c = 0; c < 3; c++) pixels[i * 4 + c] = (1 - inks[i * 4 + c]!) * (1 - inks[i * 4 + 3]!) * range;
                pixels[i * 4 + 3] = request.data[i * stride + 3]!;
            }
            yield { kind: "write", hue: true, position: request.position, data: new Uint8Array(inks.buffer) };
            request.data = pixels;
        }
        // Even byte sources produce fractional samples needed by PNG64 output
        // and HDRI comparison, including negative filter lobes.
        const values = request.data.map(sample => Math.fround(sample * (highDepth ? 1 : 257)) / 257);
        yield { kind: "write", evaluate: true, position: request.position, data: new Uint8Array(values.buffer) };
        if (image.magickColorspace && image.magickColorspace !== "RGB" && image.magickColorspace !== "Gray")
            yield { kind: "write", hue: true, position: request.position, data: new Uint8Array(values.map(value => value / 255).buffer) };
        const rounded = request.data.map(sample => {
            const value = Math.max(0, Math.min(range, highDepth ? Math.fround(sample) : sample));
            // Match the Q16-HDRI float quantum conversion at half-byte ties.
            return !highDepth ? Math.floor(Math.fround(Math.fround(Math.fround(value * 257) / 257) + 0.5)) : Math.round(value);
        });
        const data = highDepth ? Uint16Array.from(rounded) : Uint8Array.from(rounded);
        yield { kind: "write", highDepth, position: request.position, data: new Uint8Array(data.buffer) };
        next = samples.next();
    }
}

export function* morphPixelSteps(a: ResizeImage, b: ResizeImage, width: number, height: number, fraction: number, channels?: readonly boolean[], highDepth = false, kernels: readonly [MagickResizeKernel | undefined, MagickResizeKernel | undefined] = [undefined, undefined], settings?: ResizeFilterSettings): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // Undefined alpha stays with the first image; inactive alpha has CopyPixelTrait.
    const blendAlpha = !!(a.hasAlpha || a.inactiveAlpha) && !!(b.hasAlpha || b.inactiveAlpha), blendBlack = a.space === "cmyk" && b.space === "cmyk";
    if (!a.hasAlpha && a.inactiveAlpha) channels = [channels?.[0] ?? true, channels?.[1] ?? true, channels?.[2] ?? true, false, channels?.[4] ?? true];
    // A grayscale first frame has one color channel, shared by R, G and B.
    const gray = a.space === "b-w" || a.space === "grey16";
    const inks = a.space === "cmyk" || b.space === "cmyk", stride = inks ? 5 : 4;
    // Default and Point sampling leave unchanged dimensions unfiltered.
    if (!inks && kernels.every(kernel => kernel === undefined || kernel === "nearest") && a.width === width && a.height === height && b.width === width && b.height === height) {
        yield* interpolatePixelSteps(width * height * 4, fraction, blendAlpha, channels, highDepth, gray);
        return;
    }
    const sources = [a, b].map((image, index) => resizeSamples(image, width, height, false,
        kernels[index] === undefined && image.width === width && image.height === height,
        kernels[index] ?? (image.hasAlpha || width * height > image.width * image.height ? "mitchell" : "lanczos3"), inks || highDepth, settings, inks, true));
    while (true) {
        let blended: Float64Array | undefined, position = 0;
        for (let image = 0; image < sources.length; image++) {
            const source = sources[image]!;
            let next = source.next();
            while (!next.done && next.value?.kind !== "samples") {
                const request = next.value;
                next = source.next(yield request?.kind === "read" ? { ...request, image } : request);
            }
            if (next.done) return;
            const samples = next.value!;
            if (samples.kind !== "samples") return;
            position = samples.position;
            const input = image === 0 ? a : b;
            if (!input.hasAlpha && input.inactiveAlpha) {
                // Resize copies inactive alpha at the filter bisector, without weighting colors.
                for (let offset = 0; offset < samples.data.length; offset += stride) {
                    const pixel = position / 4 + offset / stride;
                    const sx = input.width === width ? pixel % width : resizeCopyIndex(pixel % width, input.width, width);
                    const sy = input.height === height ? Math.floor(pixel / width) : resizeCopyIndex(Math.floor(pixel / width), input.height, height);
                    const bytes = (yield { kind: "read", image, highDepth: inks || highDepth, position: (sy * input.width + sx) * 4, length: 4 })!;
                    samples.data[offset + 3] = (inks || highDepth ? new Uint16Array(bytes.slice().buffer) : bytes)[3]!;
                }
            }
            if (!blended) blended = Float64Array.from(samples.data, (value, i) => (i % stride === 3 && !blendAlpha || i % stride === 4 && !blendBlack) ? value : value * (1 - fraction));
            else for (let i = 0; i < blended.length; i++) {
                if (i % stride === 3 && !blendAlpha || i % stride === 4 && !blendBlack) continue;
                if (channels && !channels[i % stride]) blended[i] = samples.data[i]!;
                else blended[i]! += samples.data[i]! * fraction;
            }
        }
        const range = highDepth ? 65535 : 255;
        if (inks) {
            const count = blended!.length / stride, pixels = new Float64Array(count * 4), hue = a.space === "cmyk" ? new Float64Array(count * 4) : undefined;
            for (let x = 0; x < count; x++) {
                const offset = x * stride, black = blended![offset + 4]! / 65535;
                for (let channel = 0; channel < 3; channel++) {
                    const value = blended![offset + channel]! / 65535;
                    if (hue) hue[x * 4 + channel] = value;
                    pixels[x * 4 + channel] = (hue ? (1 - value) * (1 - black) : value) * range;
                }
                if (hue) hue[x * 4 + 3] = black;
                pixels[x * 4 + 3] = blended![offset + 3]! / 65535 * range;
            }
            if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(hue.buffer) };
            blended = pixels;
        }
        // Retain fractional HDRI samples for later operations and high-depth output.
        const working = blended!.map(value => Math.fround(value * (highDepth ? 1 : 257)) / 257);
        if (gray) for (let i = 0; i < working.length; i += 4) working[i + 1] = working[i + 2] = working[i]!;
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(working.buffer) };
        const rounded = blended!.map(value => {
            const quantum = Math.fround(Math.max(0, Math.min(range, value)) * (highDepth ? 1 : 257));
            return highDepth ? Math.round(quantum) : Math.floor(Math.fround(Math.fround(quantum / 257) + 0.5));
        });
        if (gray) for (let i = 0; i < rounded.length; i += 4) rounded[i + 1] = rounded[i + 2] = rounded[i]!;
        const data = highDepth ? Uint16Array.from(rounded) : Uint8Array.from(rounded);
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
}

/** Point filtering selects the source pixel containing the destination pixel center. */
export function* pointResizePixelSteps(image: { width: number; height: number; hasAlpha: boolean }, width: number, height: number, sample = false, pixelBytes = 4, sampleOffset?: { x: number; y: number }, writeMask = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // SampleImage uses 0.5 - MagickEpsilon to select the preceding pixel at ties.
    const offsetX = sample ? (sampleOffset?.x ?? 0.5) - 1e-12 : 0.5;
    const offsetY = sample ? (sampleOffset?.y ?? 0.5) - 1e-12 : 0.5;
    let start = -1;
    let pixels: Uint8Array = new Uint8Array(0);
    for (let y = 0; y < height; y++) {
        const sy = Math.min(image.height - 1, Math.max(0, Math.trunc((y + offsetY) * image.height / height)));
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), data = new Uint8Array(count * pixelBytes);
            // SampleImage checks the resized clone's initially zero write-mask
            // channel before copying pixels. Its color and alpha channels stay zero.
            if (sample && writeMask) {
                if (pixelBytes !== 1 && !image.hasAlpha) for (let x = 0; x < count; x++) {
                    if (pixelBytes === 32) new Float64Array(data.buffer)[x * 4 + 3] = 255;
                    else data.fill(255, x * pixelBytes + pixelBytes * 3 / 4, (x + 1) * pixelBytes);
                }
                yield { kind: "write", position: (y * width + left) * pixelBytes, data };
                continue;
            }
            const samples = pixelBytes === 32 ? new Float64Array(data.buffer) : pixelBytes === 8 ? new Uint16Array(data.buffer) : data;
            for (let x = 0; x < count; x++) {
                const sx = Math.min(image.width - 1, Math.max(0, Math.trunc((left + x + offsetX) * image.width / width)));
                const position = (sy * image.width + sx) * pixelBytes;
                if (position < start || position >= start + pixels.length) {
                    start = position;
                    const length = Math.min(1024, 16384 / pixelBytes, image.width - sx) * pixelBytes;
                    const bytes = yield { kind: "read", position, length };
                    if (!bytes || bytes.length !== length) throw new Error("Truncated resize pixels");
                    pixels = bytes;
                }
                data.set(pixels.subarray(position - start, position - start + pixelBytes), x * pixelBytes);
                // Resize filters premultiply alpha; SampleImage copies hidden color unchanged.
                if (pixelBytes !== 1 && !sample && image.hasAlpha && samples[x * 4 + 3] === 0) data.fill(0, x * pixelBytes, x * pixelBytes + pixelBytes * 3 / 4);
            }
            yield { kind: "write", position: (y * width + left) * pixelBytes, data };
        }
    }
}
