import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { compositePixelsSteps, magickCompositeMode } from "./composite-pixels.js";

type Raster = Pick<RgbaImage, "width" | "height" | "hasAlpha" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedEvaluateSamples">>;

// Use the shared compose formulas on bounded spans, retaining working samples and all 16 source bits.
export function* composite16PixelSteps(base: Raster, overlay: Raster, left: number, top: number, mode: string,
    args?: string, tile = false, fuzz = 0, clipToOverlay = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const baseEvaluate = !!base.evaluateSamples || base.storedEvaluateSamples !== undefined;
    const overlayEvaluate = !!overlay.evaluateSamples || overlay.storedEvaluateSamples !== undefined;
    left = Math.round(left);
    top = Math.round(top);
    const { name } = magickCompositeMode(mode);
    const maskDestination = ["dstin", "destin", "srcin", "in", "srcout", "out", "dstatop", "destatop"].includes(name);
    const extendSource = !clipToOverlay && (maskDestination || ["src", "source", "copy"].includes(name));
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width;) {
        yield;
        const sourceX = tile ? x % overlay.width : Math.max(0, Math.min(overlay.width - 1, x - left));
        const sourceY = tile ? y % overlay.height : Math.max(0, Math.min(overlay.height - 1, y - top));
        const outsideX = !tile && (x < left || x >= left + overlay.width);
        const outside = outsideX || (!tile && (y < top || y >= top + overlay.height));
        const count = Math.min(2048, base.width - x, outsideX ? x < left ? left - x : base.width - x : overlay.width - sourceX);
        const position = (y * base.width + x) * 4;
        const bytes = (yield { kind: "read", highDepth: true, evaluate: baseEvaluate, position, length: count * 4 })!;
        const samples = baseEvaluate ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
        if (outside && maskDestination && !tile && !clipToOverlay) {
            if (base.hasAlpha) for (let i = 3; i < samples.length; i += 4) samples[i] = 0;
        } else if (!outside || extendSource) {
            const sourceBytes = (yield { kind: "read", highDepth: true, evaluate: overlayEvaluate, image: 1,
                position: (sourceY * overlay.width + sourceX) * 4, length: outsideX ? 4 : count * 4 })!;
            const sourceSamples = overlayEvaluate ? new Float64Array(sourceBytes.slice().buffer) : Float64Array.from(new Uint16Array(sourceBytes.slice().buffer), value => value / 257);
            const dst = { ...base, width: count, height: 1, data: samples };
            const src = { ...overlay, width: count, height: 1, data: new Float64Array(count * 4) };
            for (let i = 0; i < src.data.length; i++) src.data[i] = sourceSamples[outsideX ? i % 4 : i]!;
            const result = new Float64Array(count * 4);
            yield* compositePixelsSteps(dst, src, result, mode, 0, 0, args, fuzz, clipToOverlay);
            for (let i = 0; i < samples.length; i++) samples[i] = baseEvaluate || overlayEvaluate ? Math.fround(result[i]! * 257) / 257 : result[i]!;
        }
        if (baseEvaluate || overlayEvaluate) yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        const data = Uint16Array.from(samples, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(data.buffer) };
        x += count;
    }
}
