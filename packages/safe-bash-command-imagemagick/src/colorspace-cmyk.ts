import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";
import { formatMetricNum } from "./compare-kernel.js";

export function rgbToCmyk(r: number, g: number, b: number): number[] {
    const maximum = Math.max(r, g, b);
    return maximum === 0 ? [0, 0, 0, 1] : [1 - r / maximum, 1 - g / maximum, 1 - b / maximum, 1 - maximum];
}

export function* convertCmykPixels(image: RgbaImage & HueMetadata): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.space === "cmyk" && image.hueSamples) return image;
    // The codec backing remains RGBA; the working plane holds C, M, Y and K.
    // Alpha stays in the backing, independent of the fourth ink channel.
    const hueSamples = new Float64Array(image.data.length);
    const input = image.data16 ?? image.data, range = image.data16 ? 65535 : 255;
    for (let offset = 0; offset < input.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        hueSamples.set(rgbToCmyk(input[offset]! / range, input[offset + 1]! / range, input[offset + 2]! / range), offset);
    }
    return { ...image, space: "cmyk", channels: 4, hueSamples };
}

export function formatCmykPixel(channels: readonly number[], hasAlpha: boolean): string {
    return `cmyk${hasAlpha ? "a" : ""}(${channels.slice(0, 4).map(value => formatMetricNum(value * 255)).join(",")}${hasAlpha ? `,${formatMetricNum(channels[4] ?? 1)}` : ""})`;
}
