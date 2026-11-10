import { regionContains, type Region } from "./region.js";
import { blendMaskedPixel } from "./write-mask.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Source 0 is the extra plane, source 1 the parent, and source 2 its write mask. */
export function* negateMetaPixelSteps(image: { width: number; height: number; hasAlpha: boolean; alphaBlend?: boolean | undefined; region?: Region | undefined }, onlyGray: boolean, mask?: { width: number; height: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x += 512) {
        yield;
        const length = Math.min(512, image.width - x) * 4, position = (y * image.width + x) * 4;
        const working = yield { kind: "read", evaluate: true, position, length };
        const samples = working?.length ? new Float64Array(working.slice().buffer)
            : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, position, length })!.slice().buffer), value => value / 257);
        let colors: Float64Array | Uint16Array | undefined;
        if (onlyGray) {
            const hue = yield { kind: "read", hue: true, image: 1, position, length };
            const working = hue?.length ? hue : yield { kind: "read", evaluate: true, image: 1, position, length };
            colors = working?.length ? new Float64Array(working.slice().buffer)
                : new Uint16Array((yield { kind: "read", highDepth: true, image: 1, position, length })!.slice().buffer);
        }
        const original = image.region || mask ? samples.slice() : undefined;
        let parent: Float64Array | undefined, protection: Float64Array | undefined;
        if (original) {
            const working = yield { kind: "read", evaluate: true, image: 1, position, length };
            parent = working?.length ? new Float64Array(working.slice().buffer)
                : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: 1, position, length })!.slice().buffer), value => value / 257);
        }
        if (mask) {
            const maskX = Math.min(x, mask.width - 1), maskLength = Math.min(length / 4, mask.width - maskX) * 4;
            const maskPosition = (Math.min(y, mask.height - 1) * mask.width + maskX) * 4;
            const working = yield { kind: "read", evaluate: true, image: 2, position: maskPosition, length: maskLength };
            protection = working?.length ? new Float64Array(working.slice().buffer)
                : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: 2, position: maskPosition, length: maskLength })!.slice().buffer), value => value / 257);
        }
        for (let offset = 0; offset < length; offset += 4) {
            if (!colors || colors[offset] === colors[offset + 1] && colors[offset + 1] === colors[offset + 2])
                for (let channel = 0; channel < 3; channel++) samples[offset + channel] = 255 - samples[offset + channel]!;
            if (original && parent) {
                // Clip-cache compositing uses the parent alpha, not the opaque plane backing.
                const alpha = samples[offset + 3]!;
                original[offset + 3] = samples[offset + 3] = parent[offset + 3]!;
                if (protection) {
                    const m = Math.min(offset, protection.length - 4);
                    const intensity = (0.212656 * protection[m]! + 0.715158 * protection[m + 1]! + 0.072186 * protection[m + 2]!) / 255;
                    blendMaskedPixel(samples, original, samples, offset, intensity, 255, undefined, image.hasAlpha && image.alphaBlend !== false);
                }
                if (image.region) blendMaskedPixel(samples, original, samples, offset,
                    regionContains(image.region, x + offset / 4, y) ? 0 : 1, 255, undefined, image.hasAlpha && image.alphaBlend !== false);
                samples[offset + 3] = alpha;
            }
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        const bounded = Uint16Array.from(samples, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
    }
}
