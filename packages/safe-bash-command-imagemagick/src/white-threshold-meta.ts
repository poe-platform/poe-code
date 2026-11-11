import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { magickIntensity } from "./intensity.js";

/** Native PixelInfo has no extra-channel threshold: its cutoff is always zero. */
export function* whiteThresholdMetaPixelSteps(image: Pick<RgbaImage, "width" | "height" | "space"> & { magickColorspace?: string | undefined }, independent: boolean, intensity: string): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const size = image.width * image.height * 4;
    for (let position = 0; position < size; position += 2048) {
        yield;
        const length = Math.min(2048, size - position);
        const bytes = (yield { kind: "read", highDepth: true, position, length })!;
        const data = new Uint16Array(bytes.slice().buffer);
        const working = yield { kind: "read", evaluate: true, position, length };
        const samples = working?.length ? new Float64Array(working.slice().buffer) : Float64Array.from(data, value => value / 257);
        let source = samples;
        let maximum = 255;
        if (!independent) {
            const hue = image.space === "cmyk" ? yield { kind: "read", image: 1, hue: true, position, length } : undefined;
            const evaluated = hue?.length ? hue : yield { kind: "read", image: 1, evaluate: true, position, length };
            if (evaluated?.length) {
                source = new Float64Array(evaluated.slice().buffer);
                if (hue?.length) maximum = 1;
            } else {
                const pixels = (yield { kind: "read", image: 1, highDepth: true, position, length })!;
                source = Float64Array.from(new Uint16Array(pixels.slice().buffer), value => value / 257);
            }
        }
        for (let offset = 0; offset < length; offset += 4) {
            const value = independent ? samples[offset]! : magickIntensity(source[offset]!, source[offset + 1]!, source[offset + 2]!, intensity, maximum, image.magickColorspace === "RGB" || image.magickColorspace === "scRGB");
            if (value > 0) {
                data.fill(65535, offset, offset + 3);
                samples.fill(255, offset, offset + 3);
            }
        }
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(data.buffer) };
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
    }
}
