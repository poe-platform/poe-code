import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

// Anaglyph stereo shifts the left image's red, keeping right green/blue in place.
export function* stereoPixelSteps(left: Pick<RgbaImage, "width" | "height" | "hasAlpha">, right: Pick<RgbaImage, "width" | "height" | "hasAlpha">, offsetX: number, offsetY: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    if (left.width !== right.width || left.height !== right.height)
        throw new Error("left and right image sizes differ");
    for (let y = 0; y < left.height; y++) for (let x = 0; x < left.width;) {
        yield;
        const sourceX = Math.max(0, Math.min(left.width - 1, x - offsetX));
        const sourceY = Math.max(0, Math.min(left.height - 1, y - offsetY));
        const outsideX = x < offsetX || x >= offsetX + left.width;
        // Four Float64 channels fit in each bounded 16 KiB raster transfer.
        const count = Math.min(512, left.width - x, outsideX
            ? x < offsetX ? offsetX - x : left.width - x : left.width - sourceX);
        const position = (y * left.width + x) * 4;
        const inputs: Float64Array[] = [];
        for (let image = 0; image < 2; image++) {
            const source = image === 0 ? (sourceY * left.width + sourceX) * 4 : position;
            const length = image === 0 && outsideX ? 4 : count * 4;
            const working = yield { kind: "read", evaluate: true, image, position: source, length };
            if (working?.length) inputs.push(new Float64Array(working.slice().buffer));
            else {
                const bytes = (yield { kind: "read", highDepth: true, image, position: source, length })!;
                inputs.push(Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257));
            }
        }
        const samples = inputs[1]!;
        for (let i = 0; i < samples.length; i += 4) {
            const source = outsideX ? 0 : i;
            samples[i] = inputs[0]![source]!;
            samples[i + 3] = left.hasAlpha
                ? (inputs[0]![source + 3]! + (right.hasAlpha ? samples[i + 3]! : 255)) / 2 : 255;
        }
        const encoded = Uint16Array.from(samples, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(encoded.buffer) };
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        x += count;
    }
}
