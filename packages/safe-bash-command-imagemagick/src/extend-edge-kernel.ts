import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

/** Extend the pixel grid without resampling; unspecified virtual pixels repeat edges. */
export function* extendEdgePixelSteps(source: { width: number; height: number }, width: number, height: number, highDepth = false, method: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const stride = highDepth ? 8 : 4;
    const gray = method === "white" ? 255 : method === "gray" ? 128 : 0;
    const color = method === "background" && background ? background : { r: gray, g: gray, b: gray, a: method === "transparent" ? 0 : 255 };
    const fill = new Uint8Array(stride);
    const view = new DataView(fill.buffer);
    for (const [channel, value] of [color.r, color.g, color.b, color.a].entries()) {
        if (highDepth) view.setUint16(channel * 2, value * 257, true);
        else fill[channel] = value;
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width;) {
            yield;
            let count = Math.min(4096, width - x);
            let left = Math.min(x, source.width - 1), top = Math.min(y, source.height - 1), reverse = false;
            const tiled = method === "tile" || method === "mirror";
            const constant = !tiled && method !== "edge" && (x >= source.width || y >= source.height);
            if (tiled) {
                left = x % source.width; top = y % source.height;
                reverse = method === "mirror" && Math.floor(x / source.width) % 2 === 1;
                if (method === "mirror" && Math.floor(y / source.height) % 2 === 1) top = source.height - 1 - top;
                count = Math.min(count, source.width - left);
                if (reverse) left = source.width - left - count;
            } else if (method !== "edge" && !constant) count = Math.min(count, source.width - x);
            const data = new Uint8Array(count * stride);
            if (constant) {
                for (let pixel = 0; pixel < count; pixel++) data.set(fill, pixel * stride);
            } else {
                const length = Math.min(count, source.width - left);
                const bytes = (yield { kind: "read", highDepth, position: (top * source.width + left) * 4, length: length * 4 })!;
                if (reverse) {
                    for (let pixel = 0; pixel < count; pixel++) data.set(bytes.subarray((count - pixel - 1) * stride, (count - pixel) * stride), pixel * stride);
                } else {
                    data.set(bytes);
                    for (let pixel = length; pixel < count; pixel++) data.set(bytes.subarray(bytes.length - stride), pixel * stride);
                }
            }
            yield { kind: "write", highDepth, position: (y * width + x) * 4, data };
            x += count;
        }
    }
}
