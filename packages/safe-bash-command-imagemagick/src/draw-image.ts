import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { sampleLookup, type LookupInterpolation } from "./sequence-kernel.js";

type Raster = Pick<RgbaImage, "width" | "height" | "hasAlpha">;

// MVG Over uses an inclusive affine footprint and interpolated edge pixels.
// Other operators use the ordinary clipped compositor instead.
export function* drawImageOverSteps(base: Raster, source: Raster, affine: readonly [number, number, number, number, number, number], interpolation: LookupInterpolation = "bilinear"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const [a, b, c, d, tx, ty] = affine;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new Error("Drawing image requires an invertible affine transform");
    const corners = ([[0, 0], [source.width, 0], [0, source.height], [source.width, source.height]] as const).map(([x, y]) => [a * x + c * y + tx, b * x + d * y + ty] as const);
    const left = Math.min(...corners.map(point => point[0])), right = Math.max(...corners.map(point => point[0]));
    const top = Math.max(0, Math.ceil(Math.min(...corners.map(point => point[1])) - 0.5));
    const bottom = Math.min(base.height - 1, Math.floor(Math.max(...corners.map(point => point[1])) + 0.5));
    const inverse = [d / determinant, -b / determinant, -c / determinant, a / determinant] as const;
    for (let y = 0; y < base.height; y++) {
        let first = left, last = right;
        // Intersect this scanline with both axes of the source rectangle.
        for (const [slope, offset, size] of [
            [inverse[0], inverse[2] * (y - ty) - inverse[0] * tx, source.width],
            [inverse[1], inverse[3] * (y - ty) - inverse[1] * tx, source.height],
        ] as const) {
            if (Math.abs(slope) < 1e-12) continue;
            const start = -offset / slope, end = (size - offset) / slope;
            first = Math.max(first, Math.min(start, end));
            last = Math.min(last, Math.max(start, end));
        }
        first = Math.max(0, Math.ceil(first - 0.5));
        last = Math.min(base.width - 1, Math.floor(last + 0.5));
        for (let x = 0; x < base.width; x += 512) {
            yield;
            const position = (y * base.width + x) * 4, length = Math.min(512, base.width - x) * 4;
            const working = yield { kind: "read", evaluate: true, position, length };
            const bytes = working?.length ? working : (yield { kind: "read", highDepth: true, position, length })!;
            const pixels = working?.length ? new Float64Array(bytes.slice().buffer) : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
            if (y >= top && y <= bottom) for (let dx = Math.max(x, first); dx <= Math.min(x + length / 4 - 1, last); dx++) {
                const sx = inverse[0] * (dx - tx) + inverse[2] * (y - ty);
                const sy = inverse[1] * (dx - tx) + inverse[3] * (y - ty);
                const pixel = yield* sampleLookup(source, sx, sy, true, interpolation);
                const offset = (dx - x) * 4, alpha = pixel[3]! / 65535;
                const destinationAlpha = base.hasAlpha ? pixels[offset + 3]! / 255 : 1;
                const combined = alpha + destinationAlpha * (1 - alpha);
                for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = combined === 0 ? 0
                    : Math.fround((pixel[channel]! * alpha + pixels[offset + channel]! * 257 * destinationAlpha * (1 - alpha)) / combined) / 257;
                pixels[offset + 3] = Math.fround(combined * 65535) / 257;
            }
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(pixels.buffer) };
            const rounded = Uint16Array.from(pixels, value => Math.max(0, Math.min(65535, Math.round(value * 257))));
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(rounded.buffer) };
        }
    }
}
