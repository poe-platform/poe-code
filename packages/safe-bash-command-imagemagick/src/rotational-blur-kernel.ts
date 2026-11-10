import { regionContains, type Region } from "./region.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function* rotationalBlurPixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16" | "evaluateSamples" | "space"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples">> & { region?: Region | undefined; alphaBlend?: boolean | undefined; hasAlpha?: boolean; inactiveAlpha?: boolean | undefined }, angle: number, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(image.data16 || image.storedData16);
    const evaluate = !!image.evaluateSamples || image.storedEvaluateSamples !== undefined;
    const { width, height } = image, cx = (width - 1) / 2, cy = (height - 1) / 2, radius = Math.hypot(cx, cy);
    const radians = angle * Math.PI / 180, samples = Math.max(2, Math.floor(Math.abs(4 * radians * Math.sqrt(radius) + 2)));
    if (!Number.isFinite(angle) || samples > 100_000) throw new Error("Rotational blur sample count exceeds limit");
    const cosines = new Float64Array(samples), sines = new Float64Array(samples);
    // Preserve native operation order: rounding at half-pixel boundaries selects the sample.
    const angularStep = radians / (samples - 1), offset = angularStep * (samples - 1) / 2;
    for (let j = 0; j < samples; j++) {
        yield;
        const theta = angularStep * j - offset;
        cosines[j] = Math.cos(theta); sines[j] = Math.sin(theta);
    }
    const alphaActive = image.hasAlpha || image.alphaBlend !== false;
    const gray = image.space === "b-w" || image.space === "grey16";
    const mask = channels ? [channels.r, gray ? channels.r : channels.g, gray ? channels.r : channels.b, channels.a] : undefined;
    const cache = new Map<number, Float64Array>();
    function* readSamples(position: number, length: number): Generator<ConvolveRequest, Float64Array, Uint8Array | undefined> {
        const page = Math.floor(position / 4096) * 4096;
        let samples = cache.get(page);
        if (!samples) {
            const count = Math.min(4096, width * height * 4 - page);
            const bytes = yield { kind: "read", evaluate, highDepth: true, position: page, length: count };
            if (!bytes || bytes.length !== count * (evaluate ? 8 : 2)) throw new Error("Truncated rotational blur pixels");
            samples = evaluate ? new Float64Array(bytes.slice().buffer).map(value => value * 257)
                : Float64Array.from(new Uint16Array(bytes.slice().buffer));
            if (cache.size === 32) cache.delete(cache.keys().next().value!);
            cache.set(page, samples);
        }
        return samples.subarray(position - page, position - page + length);
    }
    // Native uses nearest pixels, truncating coordinates toward zero after adding 0.5.
    for (let start = 0; start < width * height; start += 1024) {
        yield;
        const count = Math.min(1024, width * height - start);
        const values = (yield* readSamples(start * 4, count * 4)).slice();
        for (let i = 0; i < count; i++) {
            yield;
            const dx = (start + i) % width - cx, dy = Math.floor((start + i) / width) - cy, distance = Math.hypot(dx, dy);
            const step = distance === 0 ? 1 : Math.max(1, Math.min(samples - 1, Math.floor(radius / distance)));
            const sums = [0, 0, 0, 0];
            let total = 0;
            for (let j = 0; j < samples; j += step) {
                yield;
                const cos = cosines[j]!, sin = sines[j]!;
                let x = Math.trunc(cx + dx * cos - dy * sin + 0.5), y = Math.trunc(cy + dx * sin + dy * cos + 0.5);
                let pixel: Float64Array | number[] | undefined;
                if (x < 0 || y < 0 || x >= width || y >= height) {
                    const index = virtualPixelIndex(x, y, width, height, virtualPixel);
                    if (index >= 0) {
                        x = index % width; y = Math.floor(index / width);
                    } else {
                        // Native gray is half the quantum range; round only the final blurred pixel.
                        const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 127.5 : 0;
                        const samples = (virtualPixel === "background" || virtualPixel?.endsWith("-tile")) ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 255];
                        pixel = samples.map(value => value * 257);
                    }
                }
                pixel ??= yield* readSamples((y * width + x) * 4, 4);
                const alpha = alphaActive ? pixel[3]! : 65535;
                for (let c = 0; c < 3; c++) sums[c]! += pixel[c]! * alpha;
                sums[3]! += alpha;
                total++;
            }
            const x = (start + i) % width, y = Math.floor((start + i) / width), region = image.region;
            const protectedPixel = region && !regionContains(region, x, y);
            const sourceAlpha = alphaActive ? values[i * 4 + 3]! / 65535 : 1;
            const editedAlpha = alphaActive ? (mask && !mask[3] ? values[i * 4 + 3]! : sums[3]! / total) / 65535 : 1;
            // Retain inactive or disabled alpha instead of storing opaque RGB weights.
            for (let c = 0; c < (alphaActive && !image.inactiveAlpha ? 4 : 3); c++) if (!mask || mask[c]) {
                let value = c === 3 ? sums[3]! / total : sums[3] ? sums[c]! / sums[3] : 0;
                // Composite before quantizing: native retains fractional blur samples in its cache.
                if (protectedPixel) value = c === 3 ? values[i * 4 + c]! : values[i * 4 + c]! * sourceAlpha + value * editedAlpha * (1 - sourceAlpha);
                // Q16-HDRI stores float32 quantum samples between operators.
                values[i * 4 + c] = Math.fround(value);
            }
        }
        const data = highDepth ? Uint16Array.from(values, value => Math.max(0, Math.min(65535, Math.round(value))))
            : Uint8Array.from(values, value => Math.max(0, Math.min(255, Math.round(value / 257))));
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(values.map(value => value / 257).buffer) };
    }
}
