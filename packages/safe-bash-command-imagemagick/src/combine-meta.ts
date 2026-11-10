import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { HueMetadata } from "./colorspace-hue.js";
import { magickIntensity } from "./intensity.js";

export interface MetaChannels {
    metaChannels?: RgbaImage[] | undefined;
    storedMetaChannels?: StoredRgbaImage[] | undefined;
}

/** Extra combine inputs use the first image's extent, just like the color planes. */
export function* combineMetaPixelSteps(extent: Pick<RgbaImage, "width" | "height">, source: Pick<RgbaImage, "width" | "height"> & HueMetadata, highDepth: boolean, intensity: string): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const maximum = highDepth ? 65535 : 255;
    for (let y = 0; y < extent.height; y++) for (let x = 0; x < extent.width; x += 512) {
        yield;
        const length = Math.min(512, extent.width - x) * 4;
        const data = highDepth ? new Uint16Array(length) : new Uint8Array(length);
        const working = new Float64Array(length);
        const count = y < source.height ? Math.max(0, Math.min(length, (source.width - x) * 4)) : 0;
        const bytes = count ? (yield { kind: "read", highDepth, position: (y * source.width + x) * 4, length: count })! : new Uint8Array();
        const samples = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
        for (let offset = 0; offset < length; offset += 4) {
            const value = offset < count ? magickIntensity(samples[offset]!, samples[offset + 1]!, samples[offset + 2]!, intensity, maximum, source.magickColorspace === "RGB") : 0;
            data[offset] = data[offset + 1] = data[offset + 2] = Math.round(value);
            working[offset] = working[offset + 1] = working[offset + 2] = value * 255 / maximum;
            working[offset + 3] = 255;
            data[offset + 3] = maximum;
        }
        yield { kind: "write", evaluate: true, position: (y * extent.width + x) * 4, data: new Uint8Array(working.buffer) };
        yield { kind: "write", highDepth, position: (y * extent.width + x) * 4, data: new Uint8Array(data.buffer) };
    }
}
