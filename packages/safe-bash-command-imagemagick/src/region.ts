import { blendMaskedPixel, type MaskChannels } from "./write-mask.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export interface Region { x: number; y: number; width: number; height: number }

/** Right-angle rotations move the selection with the entire raster. */
export function rotateRegion(region: Region, image: { width: number; height: number }, angle: number): Region {
    const turn = ((angle % 360) + 360) % 360;
    // A fresh region also prevents the pipeline from masking the rotated raster.
    return orientRegion({ ...region }, { ...image, orientation: turn === 90 ? 6 : turn === 180 ? 3 : turn === 270 ? 8 : 1 });
}

/** Removing rows and columns keeps a rectangular region rectangular. */
export function chopRegion(region: Region, x0: number, y0: number, x1: number, y1: number): Region {
    const x = region.x - Math.max(0, Math.min(region.x, x1) - x0);
    const y = region.y - Math.max(0, Math.min(region.y, y1) - y0);
    const right = region.x + region.width;
    const bottom = region.y + region.height;
    return {
        x, y,
        width: right - Math.max(0, Math.min(right, x1) - x0) - x,
        height: bottom - Math.max(0, Math.min(bottom, y1) - y0) - y,
    };
}

/** Move the selection with EXIF pixel coordinates, including mirrored orientations. */
export function orientRegion(region: Region, image: { width: number; height: number; orientation?: number | undefined }): Region {
    const { x, y, width, height } = region;
    switch (image.orientation) {
        case 2: return { ...region, x: image.width - x - width };
        case 3: return { ...region, x: image.width - x - width, y: image.height - y - height };
        case 4: return { ...region, y: image.height - y - height };
        case 5: return { x: y, y: x, width: height, height: width };
        case 6: return { x: image.height - y - height, y: x, width: height, height: width };
        case 7: return { x: image.height - y - height, y: image.width - x - width, width: height, height: width };
        case 8: return { x: y, y: image.width - x - width, width: height, height: width };
        default: return region;
    }
}

/** Apply a white write mask outside the selected rectangle in bounded chunks. */
export function* regionPixelSteps(image: { width: number; height: number; hasAlpha: boolean; alphaBlend?: boolean | undefined }, region: Region, highDepth = false, channels?: MaskChannels): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const left = Math.max(0, Math.min(image.width, region.x));
    const right = Math.max(left, Math.min(image.width, region.x + region.width));
    for (let y = 0; y < image.height; y++) {
        yield;
        const spans = y < region.y || y >= region.y + region.height ? [[0, image.width, 1]] : [[0, left, 1], [left, right, 0], [right, image.width, 1]];
        for (const [start, end, source] of spans) {
            for (let x = start!; x < end!; x += 4096) {
                const position = (y * image.width + x) * 4, length = Math.min(4096, end! - x) * 4;
                // Gamma and other HDRI operations must not round before mask compositing.
                const working = yield { kind: "read", evaluate: true, image: source!, position, length };
                const original = working?.length ? new Float64Array(working.slice().buffer)
                    : Float64Array.from(highDepth ? new Uint16Array((yield { kind: "read", highDepth, image: source!, position, length })!.slice().buffer)
                        : (yield { kind: "read", image: source!, position, length })!, value => highDepth ? value / 257 : value);
                const output = original.slice();
                if (source === 1) {
                    const editedWorking = yield { kind: "read", evaluate: true, position, length };
                    const edited = editedWorking?.length ? new Float64Array(editedWorking.slice().buffer)
                        : Float64Array.from(highDepth ? new Uint16Array((yield { kind: "read", highDepth, position, length })!.slice().buffer)
                            : (yield { kind: "read", position, length })!, value => highDepth ? value / 257 : value);
                    for (let offset = 0; offset < output.length; offset += 4) blendMaskedPixel(output, original, edited, offset, 1, 255, channels, image.hasAlpha || image.alphaBlend !== false);
                }
                yield { kind: "write", evaluate: true, position, data: new Uint8Array(output.buffer) };
                const bounded = highDepth ? Uint16Array.from(output, value => Math.round(Math.max(0, Math.min(65535, value * 257))))
                    : Uint8Array.from(output, value => Math.round(Math.max(0, Math.min(255, value))));
                yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
            }
        }
    }
}
