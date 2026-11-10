import { rgbToCmyk } from "./colorspace-cmyk.js";
import type { ResizeKernel } from "@poe-code/image-ast/portable";
import { interpolatePixelSteps } from "./sequence-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export type MagickResizeKernel = ResizeKernel | "gaussian" | "jinc" | "lagrange" | "sinc" | "sincfast" | "magickernelsharp2013" | "magickernelsharp2021" | "lanczos2sharp" | "lanczossharp" | "box" | "catrom" | "cubicspline" | "hermite" | "quadratic" | "robidoux" | "robidouxsharp" | "bartlett" | "blackman" | "bohman" | "cosine" | "hamming" | "hann" | "kaiser" | "parzen" | "welch";

export type ResizeFilterSettings = { blur?: number; support?: number; lobes?: number; b?: number; c?: number; sigma?: number; window?: MagickResizeKernel };

export function* adaptiveResizePixelSteps(image: { width: number; height: number; hasAlpha: boolean }, width: number, height: number, highDepth: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const maximum = highDepth ? 65535 : 255;
    for (let start = 0; start < width * height; start += 256) {
        yield;
        const count = Math.min(256, width * height - start);
        const data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        for (let offset = 0; offset < count; offset++) {
            const x = ((start + offset) % width + 0.5) * image.width / width - 0.5;
            const y = (Math.floor((start + offset) / width) + 0.5) * image.height / height - 0.5;
            const left = Math.floor(x), top = Math.floor(y), dx = x - left, dy = y - top;
            const pixels: (Uint8Array | Uint16Array)[] = [];
            for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
                const sx = Math.max(0, Math.min(image.width - 1, left + column));
                const sy = Math.max(0, Math.min(image.height - 1, top + row));
                const bytes = (yield { kind: "read", highDepth, position: (sy * image.width + sx) * 4, length: 4 })!;
                pixels.push(highDepth ? new Uint16Array(bytes.slice().buffer) : bytes);
            }
            const luma = pixels.map(p => 0.212656 * p[0]! + 0.715158 * p[1]! + 0.072186 * p[2]!);
            // Choose the diagonal with the smaller luma difference, then its enclosing triangle.
            const weights = Math.abs(luma[0]! - luma[3]!) < Math.abs(luma[1]! - luma[2]!)
                ? dx <= dy ? [1 - dy, 0, dy - dx, dx] : [1 - dx, dx - dy, 0, dy]
                : dx <= 1 - dy ? [1 - dx - dy, dx, dy, 0] : [0, 1 - dy, 1 - dx, dx + dy - 1];
            const alpha = pixels.reduce((sum, p, i) => sum + p[3]! * weights[i]!, 0);
            for (let channel = 0; channel < 4; channel++) {
                // Native mesh divides unassociated colors by interpolated alpha.
                const value = channel === 3 ? alpha : pixels.reduce((sum, p, i) => sum + p[channel]! * weights[i]!, 0)
                    / (image.hasAlpha ? Math.max(1e-12, alpha / maximum) : 1);
                const scale = highDepth ? 1 : 257;
                data[offset * 4 + channel] = Math.max(0, Math.min(maximum, Math.round(Math.fround(value * scale) / scale)));
            }
        }
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
    let scale = Math.max(1, source / target) * blur;
    const narrow = radius * scale < 0.5;
    const center = (index + 0.5) * source / target + (narrow ? 1e-12 : 0) - 0.5;
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
    for (let i = 0; i < weights.length; i++) weights[i]! /= Math.abs(sum) >= 1e-12 ? sum : sum < 0 ? -1e-12 : 1e-12;
    return { first, weights };
}

type ResizeImage = { width: number; height: number; hasAlpha: boolean; space?: string };
type ResizeSamples = Generator<ConvolveRequest | { kind: "samples"; position: number; data: Float64Array } | undefined, void, Uint8Array | undefined>;

/** Keep HDRI samples unclamped until all resizing and morph blending is finished. */
function* resizeSamples(image: ResizeImage, width: number, height: number, thumbnail: boolean, scale: boolean, kernel: MagickResizeKernel, highDepth = false, settings: ResizeFilterSettings = {}, inks = false, preserveSamples = false): ResizeSamples {
    // An explicit window selects the Sinc weighting function with four-lobe support.
    if (settings.window) kernel = "sinc";
    // Working CMYK rows use C, M, Y, alpha, K; black is never an alpha weight.
    const range = highDepth ? 65535 : 255, stride = inks ? 5 : 4;
    // ImageMagick sharpens the sinc window by narrowing its support.
    const blur = Math.max(1e-12, (settings.blur ?? 1) * (kernel === "lanczos2sharp" ? 0.9549963639785485
        : kernel === "lanczossharp" ? 0.9812505644269356 : 1));
    const thumbnailFactor = thumbnail ? Math.floor(Math.min(image.width / width, image.height / height)) : 0;
    for (let left = 0; left < width; left += 256) {
        const count = Math.min(256, width - left), horizontal = Array.from({ length: count }, (_, x) => contributions(left + x, image.width, width, blur, scale, kernel, thumbnailFactor, settings));
        const rows = new Map<number, Float64Array>();
        for (let y = 0; y < height; y++) {
            yield;
            const vertical = contributions(y, image.height, height, blur, scale, kernel, thumbnailFactor, settings), sums = new Float64Array(count * stride);
            for (let k = 0; k < vertical.weights.length; k++) {
                const sy = vertical.first + k;
                let row = rows.get(sy);
                if (!row) {
                    yield;
                    row = new Float64Array(count * stride);
                    const first = horizontal[0]!.first, last = horizontal[count - 1]!;
                    const end = last.first + last.weights.length;
                    for (let start = first; start < end; start += 1024) {
                        if (start > first) yield;
                        const length = Math.min(1024, end - start);
                        const position = (sy * image.width + start) * 4;
                        const samples = preserveSamples ? yield { kind: "read", evaluate: true, position, length: length * 4 } : undefined;
                        let pixels: Uint8Array | Uint16Array | Float64Array;
                        if (samples?.length) {
                            pixels = new Float64Array(samples.slice().buffer);
                            if (highDepth) pixels = pixels.map(value => value * 257);
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

export function* resizePixelSteps(image: ResizeImage, width: number, height: number, thumbnail: boolean, scale = false, kernel: MagickResizeKernel = "lanczos3", highDepth = false, settings?: ResizeFilterSettings, preserveSamples = false, writeMask = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
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
    const samples = resizeSamples(image, width, height, thumbnail, scale, kernel, highDepth, settings, false, preserveSamples);
    const range = highDepth ? 65535 : 255;
    let next = samples.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind !== "samples") { next = samples.next(yield request); continue; }
        if (preserveSamples) {
            // Comparison uses HDRI values, including negative filter lobes.
            const values = request.data.map(sample => Math.fround(sample * (highDepth ? 1 : 257)) / 257);
            yield { kind: "write", evaluate: true, position: request.position, data: new Uint8Array(values.buffer) };
        }
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

export function* morphPixelSteps(a: ResizeImage, b: ResizeImage, width: number, height: number, fraction: number, channels?: readonly boolean[], highDepth = false, kernel?: MagickResizeKernel, settings?: ResizeFilterSettings): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // ImageMagick retains the first image's alpha unless both alpha channels are active.
    const blendAlpha = a.hasAlpha && b.hasAlpha, blendBlack = a.space === "cmyk" && b.space === "cmyk";
    // A grayscale first frame has one color channel, shared by R, G and B.
    const gray = a.space === "b-w" || a.space === "grey16";
    const inks = a.space === "cmyk" || b.space === "cmyk", stride = inks ? 5 : 4;
    if (!inks && a.width === width && a.height === height && b.width === width && b.height === height) {
        yield* interpolatePixelSteps(width * height * 4, fraction, blendAlpha, channels, highDepth, gray);
        return;
    }
    const sources = [a, b].map(image => resizeSamples(image, width, height, false,
        image.width === width && image.height === height,
        kernel ?? (image.hasAlpha || width * height > image.width * image.height ? "mitchell" : "lanczos3"), inks || highDepth, settings, inks));
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
            if (!blended) blended = Float64Array.from(samples.data, (value, i) => (i % stride === 3 && !blendAlpha || i % stride === 4 && !blendBlack) ? value : value * (1 - fraction));
            else for (let i = 0; i < blended.length; i++) {
                if (i % stride === 3 && !blendAlpha || i % stride === 4 && !blendBlack) continue;
                if (channels && i % stride !== 4 && !channels[i % stride]) blended[i] = samples.data[i]!;
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
                if (!image.hasAlpha) for (let x = 0; x < count; x++) {
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
                    const length = Math.min(1024, image.width - sx) * pixelBytes;
                    const bytes = yield { kind: "read", position, length };
                    if (!bytes || bytes.length !== length) throw new Error("Truncated resize pixels");
                    pixels = bytes;
                }
                data.set(pixels.subarray(position - start, position - start + pixelBytes), x * pixelBytes);
                // Resize filters premultiply alpha; SampleImage copies hidden color unchanged.
                if (!sample && image.hasAlpha && samples[x * 4 + 3] === 0) data.fill(0, x * pixelBytes, x * pixelBytes + pixelBytes * 3 / 4);
            }
            yield { kind: "write", position: (y * width + left) * pixelBytes, data };
        }
    }
}
