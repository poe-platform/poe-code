import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { compositePixelsSteps, magickCompositeMode } from "./composite-pixels.js";

type Raster = Pick<RgbaImage, "width" | "height" | "hasAlpha" | "evaluateSamples" | "data16" | "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples" | "storedData16" | "storedHueSamples">>;

// Use the shared compose formulas on bounded spans, retaining working samples and all 16 source bits.
// Meta planes take alpha from their parent images, supplied as raster sources 2 and 3.
export function* composite16PixelSteps(base: Raster, overlay: Raster, left: number, top: number, mode: string,
    args?: string, tile = false, fuzz = 0, clipToOverlay = false, alphaSources?: readonly [Raster, Raster], copyChannels = false, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(base.data16 || overlay.data16 || base.storedData16 || overlay.storedData16);
    const baseEvaluate = !!base.evaluateSamples || base.storedEvaluateSamples !== undefined;
    const overlayEvaluate = !!overlay.evaluateSamples || overlay.storedEvaluateSamples !== undefined;
    left = Math.round(left);
    top = Math.round(top);
    const { name } = magickCompositeMode(mode);
    const clippedCopy = clipToOverlay && !tile && name === "copy"
        && (left < 0 || top < 0 || left + overlay.width > base.width || top + overlay.height > base.height);
    const maskDestination = ["dstin", "destin", "srcin", "in", "srcout", "out", "dstatop", "destatop"].includes(name);
    const extendSource = !clipToOverlay && (maskDestination || ["src", "source", "copy"].includes(name));
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width;) {
        yield;
        const sourceX = tile ? x % overlay.width : Math.max(0, Math.min(overlay.width - 1, x - left));
        const sourceY = tile ? y % overlay.height : Math.max(0, Math.min(overlay.height - 1, y - top));
        const outsideX = !tile && (x < left || x >= left + overlay.width);
        const outside = outsideX || (!tile && (y < top || y >= top + overlay.height));
        // Four Float64 channels must fit the 16 KiB storage transfer limit.
        const count = Math.min(512, base.width - x, outsideX ? x < left ? left - x : base.width - x : overlay.width - sourceX);
        const position = (y * base.width + x) * 4;
        const bytes = (yield { kind: "read", highDepth: true, evaluate: baseEvaluate, position, length: count * 4 })!;
        const samples = baseEvaluate ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
        let inks: Float64Array | undefined;
        if (copyChannels && base.space === "cmyk") {
            const bytes = (yield { kind: "read", hue: true, position, length: count * 4 })!;
            inks = bytes.length ? new Float64Array(bytes.slice().buffer) : new Float64Array(count * 4);
            for (let i = 0; i < samples.length; i += 4) {
                if (!bytes.length) inks.set(rgbToCmyk(samples[i]! / 255, samples[i + 1]! / 255, samples[i + 2]! / 255), i);
                for (let c = 0; c < 3; c++) samples[i + c] = inks[i + c]! * 255;
            }
        }
        if (alphaSources) {
            const evaluate = !!alphaSources[0].evaluateSamples || alphaSources[0].storedEvaluateSamples !== undefined;
            const bytes = (yield { kind: "read", image: 2, highDepth: true, evaluate, position, length: count * 4 })!;
            const alpha = evaluate ? new Float64Array(bytes.slice().buffer) : new Uint16Array(bytes.slice().buffer);
            for (let i = 3; i < samples.length; i += 4) samples[i] = alpha[i]! / (evaluate ? 1 : 257);
        }
        if (outside && maskDestination && !tile && !clipToOverlay) {
            if (base.hasAlpha && (!channels || channels[3])) for (let i = 3; i < samples.length; i += 4) samples[i] = 0;
        } else if (!outside || extendSource) {
            const sourceBytes = (yield { kind: "read", highDepth: true, evaluate: overlayEvaluate, image: 1,
                position: (sourceY * overlay.width + sourceX) * 4, length: outsideX ? 4 : count * 4 })!;
            const sourceSamples = overlayEvaluate ? new Float64Array(sourceBytes.slice().buffer) : Float64Array.from(new Uint16Array(sourceBytes.slice().buffer), value => value / 257);
            if (alphaSources) {
                const evaluate = !!alphaSources[1].evaluateSamples || alphaSources[1].storedEvaluateSamples !== undefined;
                const bytes = (yield { kind: "read", image: 3, highDepth: true, evaluate,
                    position: (sourceY * overlay.width + sourceX) * 4, length: outsideX ? 4 : count * 4 })!;
                const alpha = evaluate ? new Float64Array(bytes.slice().buffer) : new Uint16Array(bytes.slice().buffer);
                for (let i = 3; i < sourceSamples.length; i += 4) sourceSamples[i] = alpha[i]! / (evaluate ? 1 : 257);
            }
            let sourceInks: Float64Array | undefined;
            if (copyChannels && overlay.space === "cmyk") {
                const bytes = (yield { kind: "read", hue: true, image: 1,
                    position: (sourceY * overlay.width + sourceX) * 4, length: outsideX ? 4 : count * 4 })!;
                sourceInks = bytes.length ? new Float64Array(bytes.slice().buffer) : new Float64Array(sourceSamples.length);
                for (let i = 0; i < sourceSamples.length; i += 4) {
                    if (!bytes.length) sourceInks.set(rgbToCmyk(sourceSamples[i]! / 255, sourceSamples[i + 1]! / 255, sourceSamples[i + 2]! / 255), i);
                    for (let c = 0; c < 3; c++) sourceSamples[i + c] = sourceInks[i + c]! * 255;
                }
            }
            if (inks && (!channels || channels[4])) for (let i = 0; i < samples.length; i += 4) {
                const j = outsideX ? 0 : i;
                const alpha = overlay.hasAlpha ? sourceSamples[j + 3]! / 255 : 1;
                const destinationAlpha = base.hasAlpha ? samples[i + 3]! / 255 : 1;
                const total = alpha + destinationAlpha * (1 - alpha);
                const black = sourceInks?.[j + 3] ?? 0;
                inks[i + 3] = name === "copy" ? black : total === 0 ? 0
                    : (black * alpha + inks[i + 3]! * destinationAlpha * (1 - alpha)) / total;
            }
            // Native Copy premultiplies RGB when the source crosses the canvas boundary.
            if (clippedCopy) for (let i = 0; i < sourceSamples.length; i += 4)
                for (let c = 0; c < 3; c++) sourceSamples[i + c]! *= sourceSamples[i + 3]! / 255;
            const dst = { ...base, hasAlpha: alphaSources?.[0].hasAlpha ?? base.hasAlpha, width: count, height: 1, data: samples };
            const src = { ...overlay, hasAlpha: alphaSources?.[1].hasAlpha ?? overlay.hasAlpha, width: count, height: 1, data: new Float64Array(count * 4) };
            for (let i = 0; i < src.data.length; i++) src.data[i] = sourceSamples[outsideX ? i % 4 : i]!;
            const result = new Float64Array(count * 4);
            yield* compositePixelsSteps(dst, src, result, mode, 0, 0, args, fuzz, clipToOverlay);
            for (let i = 0; i < samples.length; i++)
                if (!channels || channels[i % 4]) samples[i] = Math.fround(result[i]! * 257) / 257;
        }
        if (inks) {
            for (let i = 0; i < samples.length; i += 4) for (let c = 0; c < 3; c++) {
                inks[i + c] = samples[i + c]! / 255;
                samples[i + c] = Math.fround((1 - inks[i + c]!) * (1 - inks[i + 3]!) * 65535) / 257;
            }
            yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
        } else if (copyChannels && (base.space === "b-w" || base.space === "grey16")) {
            for (let i = 0; i < samples.length; i += 4) samples[i + 1] = samples[i + 2] = samples[i]!;
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        const data = highDepth
            ? Uint16Array.from(samples, value => Math.round(Math.max(0, Math.min(65535, value * 257))))
            : Uint8Array.from(samples, value => Math.round(Math.max(0, Math.min(255, value))));
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
        x += count;
    }
}
