import { saliencyCompositeSteps } from "./saliency-compose.js";
import { distortCompositeSteps } from "./distort-compose.js";
import { blurCompositeSteps } from "./blur-compose.js";
import { seamlessCompositeSteps } from "./seamless-compose.js";
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
    const baseHue = base.space !== "cmyk" && (!!base.hueSamples || base.storedHueSamples !== undefined);
    const overlayHue = baseHue && (!!overlay.hueSamples || overlay.storedHueSamples !== undefined);
    const baseEvaluate = !!base.evaluateSamples || base.storedEvaluateSamples !== undefined;
    const overlayEvaluate = !!overlay.evaluateSamples || overlay.storedEvaluateSamples !== undefined;
    left = Math.round(left);
    top = Math.round(top);
    const { name } = magickCompositeMode(mode);
    if (name === "seamlessblend") {
        yield* seamlessCompositeSteps(base, overlay, left, top, args, tile, channels);
        return;
    }
    if (name === "saliencyblend") {
        yield* saliencyCompositeSteps(base, overlay, left, top, args, channels);
        return;
    }
    if (name === "blur" && args !== undefined) {
        yield* blurCompositeSteps(base, overlay, left, top, args, tile, channels);
        return;
    }
    if (name === "distort") {
        yield* distortCompositeSteps(base, overlay, left, top, args, tile);
        return;
    }
    const scales = name === "displace" && args !== undefined
        ? args.toLowerCase().replaceAll(",", "x").split("x").map(value => Number.parseFloat(value)) : [];
    const scaleX = scales[0] ?? (overlay.width - 1) / 2;
    const scaleY = scales[1] ?? scales[0] ?? (overlay.height - 1) / 2;
    const displacementCache = name === "displace" ? new Map<number, Float64Array>() : undefined;
    const clippedCopy = clipToOverlay && !tile && name === "copy"
        && (left < 0 || top < 0 || left + overlay.width > base.width || top + overlay.height > base.height);
    const maskDestination = ["dstin", "destin", "srcin", "in", "srcout", "out", "dstatop", "destatop"].includes(name);
    const extendSource = !clipToOverlay && (maskDestination || ["clear", "src", "source", "copy"].includes(name));
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width;) {
        yield;
        const sourceX = tile ? x % overlay.width : Math.max(0, Math.min(overlay.width - 1, x - left));
        const sourceY = tile ? y % overlay.height : Math.max(0, Math.min(overlay.height - 1, y - top));
        const outsideX = !tile && (x < left || x >= left + overlay.width);
        const outside = outsideX || (!tile && (y < top || y >= top + overlay.height));
        // Four Float64 channels must fit the 16 KiB storage transfer limit.
        const count = Math.min(512, base.width - x, outsideX ? x < left ? left - x : base.width - x : overlay.width - sourceX);
        const position = (y * base.width + x) * 4;
        const bytes = (yield { kind: "read", highDepth: true, hue: baseHue, evaluate: !baseHue && baseEvaluate, position, length: count * 4 })!;
        const samples = baseHue ? new Float64Array(bytes.slice().buffer).map(value => value * 255) : baseEvaluate ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
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
        if (outside && displacementCache) {
            // Displacement replaces the canvas, including pixels beyond the map.
            for (let i = 0; i < samples.length; i++)
                if (!channels || channels[i % 4]) samples[i] = i % 4 === 3 && !base.hasAlpha ? 255 : 0;
        } else if (outside && maskDestination && !tile && !clipToOverlay) {
            if (base.hasAlpha && (!channels || channels[3])) for (let i = 3; i < samples.length; i += 4) samples[i] = 0;
        } else if (!outside || extendSource) {
            const sourceBytes = (yield { kind: "read", highDepth: true, hue: overlayHue, evaluate: !overlayHue && overlayEvaluate, image: 1,
                position: (sourceY * overlay.width + sourceX) * 4, length: outsideX ? 4 : count * 4 })!;
            const sourceSamples = overlayHue ? new Float64Array(sourceBytes.slice().buffer).map(value => value * 255) : overlayEvaluate ? new Float64Array(sourceBytes.slice().buffer) : Float64Array.from(new Uint16Array(sourceBytes.slice().buffer), value => value / 257);
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
            if (inks && (name !== "copy" || sourceInks) && (!channels || channels[4])) {
                const destination = new Float64Array(samples.length), source = new Float64Array(samples.length);
                for (let i = 0; i < samples.length; i += 4) {
                    const j = outsideX ? 0 : i;
                    destination[i] = inks[i + 3]! * 255;
                    destination[i + 3] = base.hasAlpha ? samples[i + 3]! : 255;
                    source[i] = (sourceInks?.[j + 3] ?? 0) * 255;
                    source[i + 3] = overlay.hasAlpha ? sourceSamples[j + 3]! : 255;
                }
                const result = new Float64Array(samples.length);
                // Black is an independent ink channel and uses the selected compose operator.
                yield* compositePixelsSteps({ ...base, width: count, height: 1, data: destination },
                    { ...overlay, width: count, height: 1, data: source }, result, mode, 0, 0, args, fuzz, clipToOverlay);
                for (let i = 0; i < samples.length; i += 4) inks[i + 3] = result[i]! / 255;
            }
            // Native Copy premultiplies RGB when the source crosses the canvas boundary.
            if (clippedCopy) for (let i = 0; i < sourceSamples.length; i += 4)
                for (let c = 0; c < 3; c++) sourceSamples[i + c]! *= sourceSamples[i + 3]! / 255;
            const dst = { ...base, hasAlpha: alphaSources?.[0].hasAlpha ?? base.hasAlpha, width: count, height: 1, data: samples };
            const src = { ...overlay, hasAlpha: alphaSources?.[1].hasAlpha ?? overlay.hasAlpha, width: count, height: 1, data: new Float64Array(count * 4) };
            for (let i = 0; i < src.data.length; i++) src.data[i] = sourceSamples[outsideX ? i % 4 : i]!;
            const result = new Float64Array(count * 4);
            if (displacementCache) {
                for (let i = 0; i < samples.length; i += 4) {
                    // Q16's midpoint is 32768, so white is slightly below a full positive shift.
                    const dx = Math.max(0, Math.min(base.width - 1, x + i / 4 + scaleX * (src.data[i]! * 257 - 32768) / 32768));
                    const dy = Math.max(0, Math.min(base.height - 1, y + scaleY * (src.data[i + 1]! * 257 - 32768) / 32768));
                    const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
                    let alpha = 0;
                    for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
                        const weight = (column ? fx : 1 - fx) * (row ? fy : 1 - fy);
                        if (weight === 0) continue;
                        const position = (Math.min(base.height - 1, iy + row) * base.width + Math.min(base.width - 1, ix + column)) * 4;
                        const page = Math.floor(position / 2048) * 2048;
                        let pixels = displacementCache.get(page);
                        if (!pixels) {
                            // Always sample the original canvas, including across spans and rows.
                            const bytes = (yield { kind: "read", highDepth: true, evaluate: baseEvaluate,
                                position: page, length: Math.min(2048, base.width * base.height * 4 - page) })!;
                            pixels = baseEvaluate ? new Float64Array(bytes.slice().buffer)
                                : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
                            if (displacementCache.size === 32) displacementCache.delete(displacementCache.keys().next().value!);
                            displacementCache.set(page, pixels);
                        }
                        const offset = position - page;
                        const opacity = base.hasAlpha ? pixels[offset + 3]! / 255 : 1;
                        alpha += weight * opacity;
                        for (let channel = 0; channel < 3; channel++)
                            result[i + channel]! += pixels[offset + channel]! * weight * opacity;
                    }
                    for (let channel = 0; channel < 3; channel++) result[i + channel] = alpha ? result[i + channel]! / alpha : 0;
                    result[i + 3] = alpha * (src.hasAlpha ? src.data[i + 3]! : 255);
                }
            } else if (name === "intensity" && tile && (x - sourceX + overlay.width > base.width || y - sourceY + overlay.height > base.height)) {
                // Native Intensity falls back to source RGB and opaque alpha for clipped tiles.
                result.set(src.data);
                for (let i = 3; i < result.length; i += 4)
                    result[i] = 255;
            } else {
                yield* compositePixelsSteps(dst, src, result, mode, 0, 0, args, fuzz, clipToOverlay);
            }
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
        // Keep working colors and alpha in sync with the composited raster.
        if (baseHue) yield { kind: "write", hue: true, position, data: new Uint8Array(samples.map(value => value / 255).buffer) };
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        const data = highDepth
            ? Uint16Array.from(samples, value => Math.round(Math.max(0, Math.min(65535, value * 257))))
            : Uint8Array.from(samples, value => Math.round(Math.max(0, Math.min(255, value))));
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
        x += count;
    }
}
