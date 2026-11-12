import { rgbToCmyk } from "./colorspace-cmyk.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

/** Extend the pixel grid without resampling; unspecified virtual pixels repeat edges. */
export function* extendEdgePixelSteps(source: { width: number; height: number; space?: string | undefined; magickColorspace?: string | undefined }, width: number, height: number, highDepth = false, method: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // Preserve fractional virtual colors until sequence arithmetic finishes, even for 8-bit inputs.
    const fractionalBackground = (method === "background" || method.endsWith("-tile")) && background &&
        [background.r, background.g, background.b, background.a].some(value => !Number.isInteger(value));
    // Extend converted color samples alongside the integer pixel grid.
    for (const plane of ["rgba", ...(method === "gray" || fractionalBackground ? ["evaluate"] : []), ...(source.space === "cmyk" || source.magickColorspace && !["RGB", "scRGB", "Gray"].includes(source.magickColorspace) ? ["hue"] : [])]) {
        const hue = plane === "hue", evaluate = plane === "evaluate";
        const stride = hue || evaluate ? 32 : highDepth ? 8 : 4;
        const gray = method === "white" ? 255 : method === "gray" ? 127.5 : 0;
        const color = (method === "background" || method.endsWith("-tile")) && background ? background : { r: gray, g: gray, b: gray, a: method === "transparent" ? 0 : 255 };
        const fill = new Uint8Array(stride);
        const view = new DataView(fill.buffer);
        const values = hue ? source.space === "cmyk" ? rgbToCmyk(color.r / 255, color.g / 255, color.b / 255) : [color.r, color.g, color.b, color.a].map(value => value / 255) : [color.r, color.g, color.b, color.a];
        for (const [channel, value] of values.entries()) {
            if (hue || evaluate) view.setFloat64(channel * 8, value, true);
            else if (highDepth) view.setUint16(channel * 2, Math.round(value * 257), true);
            else fill[channel] = Math.round(value);
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width;) {
                yield;
                let count = Math.min(4096, width - x);
                const index = virtualPixelIndex(x, y, source.width, source.height, method);
                const constant = index < 0;
                let left = constant ? 0 : index % source.width;
                const top = constant ? 0 : Math.floor(index / source.width);
                const reverse = method === "mirror" && Math.floor(x / source.width) % 2 === 1;
                if (x < source.width || method === "tile" || method === "mirror" || method.includes("-tile")) count = Math.min(count, source.width - x % source.width);
                // Dither offsets both axes independently for each out-of-bounds pixel.
                if (method === "dither" && (x >= source.width || y >= source.height)) count = 1;
                if (reverse) left -= count - 1;
                const data = new Uint8Array(count * stride);
                if (constant) {
                    for (let pixel = 0; pixel < count; pixel++) data.set(fill, pixel * stride);
                } else {
                    const length = Math.min(count, source.width - left);
                    const position = (top * source.width + left) * 4;
                    let bytes = (yield { kind: "read", highDepth, hue, evaluate, position, length: length * 4 })!;
                    if (evaluate && !bytes.length) {
                        const pixels = (yield { kind: "read", highDepth, position, length: length * 4 })!;
                        const values = highDepth ? new Uint16Array(pixels.slice().buffer) : pixels;
                        bytes = new Uint8Array(Float64Array.from(values, value => highDepth ? value / 257 : value).buffer);
                    }
                    if (reverse) {
                        for (let pixel = 0; pixel < count; pixel++) data.set(bytes.subarray((count - pixel - 1) * stride, (count - pixel) * stride), pixel * stride);
                    } else {
                        data.set(bytes);
                        for (let pixel = length; pixel < count; pixel++) data.set(bytes.subarray(bytes.length - stride), pixel * stride);
                    }
                }
                yield { kind: "write", highDepth, hue, evaluate, position: (y * width + x) * 4, data };
                x += count;
            }
        }
    }
}
