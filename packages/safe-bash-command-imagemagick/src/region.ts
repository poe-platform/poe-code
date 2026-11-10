import { blendMaskedPixel, type MaskChannels } from "./write-mask.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export interface Region { x: number; y: number; width: number; height: number; wrap?: { width: number; height: number } }

/** Right-angle rotations move the selection with the entire raster. */
export function rotateRegion(region: Region, image: { width: number; height: number }, angle: number): Region {
    const turn = ((angle % 360) + 360) % 360;
    // A fresh region also prevents the pipeline from masking the rotated raster.
    return orientRegion({ ...region }, { ...image, orientation: turn === 90 ? 6 : turn === 180 ? 3 : turn === 270 ? 8 : 1 });
}

export function regionContains(region: Region, x: number, y: number): boolean {
    x -= region.x;
    y -= region.y;
    if (region.wrap) {
        x = ((x % region.wrap.width) + region.wrap.width) % region.wrap.width;
        y = ((y % region.wrap.height) + region.wrap.height) % region.wrap.height;
    }
    return x >= 0 && x < region.width && y >= 0 && y < region.height;
}

/** Roll the clipped selection on the same torus as the image pixels. */
export function rollRegion(region: Region, image: { width: number; height: number }, dx: number, dy: number): Region {
    const x = region.wrap ? region.x : Math.max(0, Math.min(image.width, region.x));
    const y = region.wrap ? region.y : Math.max(0, Math.min(image.height, region.y));
    return {
        x: ((x + dx) % image.width + image.width) % image.width,
        y: ((y + dy) % image.height + image.height) % image.height,
        width: region.wrap ? region.width : Math.max(0, Math.min(image.width, region.x + region.width) - x),
        height: region.wrap ? region.height : Math.max(0, Math.min(image.height, region.y + region.height) - y),
        wrap: { width: image.width, height: image.height },
    };
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
export function* regionPixelSteps(image: { width: number; height: number; hasAlpha: boolean; alphaBlend?: boolean | undefined; space?: string }, region: Region, highDepth = false, channels?: MaskChannels & { k?: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const left = Math.max(0, Math.min(image.width, region.x));
    const right = Math.max(left, Math.min(image.width, region.x + region.width));
    const wrappedRight = region.wrap ? Math.max(0, region.x + region.width - image.width) : 0;
    const selectedSpans = wrappedRight > 0
        ? [[0, wrappedRight, 0], [wrappedRight, left, 1], [left, right, 0]]
        : [[0, left, 1], [left, right, 0], [right, image.width, 1]];
    for (let y = 0; y < image.height; y++) {
        yield;
        const relativeY = region.wrap ? (y - region.y + image.height) % image.height : y - region.y;
        const spans = relativeY < 0 || relativeY >= region.height ? [[0, image.width, 1]] : selectedSpans;
        for (const [start, end, source] of spans) {
            for (let x = start!; x < end!; x += 512) {
                const position = (y * image.width + x) * 4, length = Math.min(512, end! - x) * 4;
                // Gamma and other HDRI operations must not round before mask compositing.
                const working = yield { kind: "read", evaluate: true, image: source!, position, length };
                const original = working?.length ? new Float64Array(working.slice().buffer)
                    : Float64Array.from(highDepth ? new Uint16Array((yield { kind: "read", highDepth, image: source!, position, length })!.slice().buffer)
                        : (yield { kind: "read", image: source!, position, length })!, value => highDepth ? value / 257 : value);
                const output = original.slice();
                const inks = image.space === "cmyk" ? new Float64Array((yield { kind: "read", hue: true, image: source!, position, length })!.slice().buffer) : undefined;
                if (source === 1) {
                    const editedWorking = yield { kind: "read", evaluate: true, position, length };
                    const edited = editedWorking?.length ? new Float64Array(editedWorking.slice().buffer)
                        : Float64Array.from(highDepth ? new Uint16Array((yield { kind: "read", highDepth, position, length })!.slice().buffer)
                            : (yield { kind: "read", position, length })!, value => highDepth ? value / 257 : value);
                    if (inks) {
                        const editedInks = new Float64Array((yield { kind: "read", hue: true, position, length })!.slice().buffer);
                        // CMYK stores black in the ink plane; alpha remains in the RGBA backing.
                        const active = image.hasAlpha || image.alphaBlend !== false;
                        const selected = channels ? [channels.r, channels.g, channels.b, channels.k !== false] : undefined;
                        for (let offset = 0; offset < inks.length; offset += 4) {
                            const sourceAlpha = active ? original[offset + 3]! / 255 : 1;
                            const editedAlpha = active ? edited[offset + 3]! / 255 : 1;
                            for (let channel = 0; channel < 4; channel++) {
                                inks[offset + channel] = !selected || selected[channel]
                                    ? Math.fround((inks[offset + channel]! * sourceAlpha + editedInks[offset + channel]! * editedAlpha * (1 - sourceAlpha)) * 65535) / 65535
                                    : editedInks[offset + channel]!;
                            }
                        }
                    }
                    for (let offset = 0; offset < output.length; offset += 4) blendMaskedPixel(output, original, edited, offset, 1, 255, channels, image.hasAlpha || image.alphaBlend !== false);
                }
                if (inks) {
                    yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
                    for (let offset = 0; offset < output.length; offset += 4) for (let channel = 0; channel < 3; channel++)
                        output[offset + channel] = (1 - inks[offset + channel]!) * (1 - inks[offset + 3]!) * 255;
                }
                yield { kind: "write", evaluate: true, position, data: new Uint8Array(output.buffer) };
                const bounded = highDepth ? Uint16Array.from(output, value => Math.round(Math.max(0, Math.min(65535, value * 257))))
                    : Uint8Array.from(output, value => Math.round(Math.max(0, Math.min(255, value))));
                yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
            }
        }
    }
}

/** Materialize a region as a write-mask channel before it stops being rectangular. */
export function* regionMaskPixelSteps(image: { width: number; height: number }, region: Region): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x += 4096) {
        yield;
        const count = Math.min(4096, image.width - x), data = new Uint8Array(count * 4);
        for (let i = 0; i < count; i++) {
            const value = regionContains(region, x + i, y) ? 0 : 255;
            data.set([value, value, value, 255], i * 4);
        }
        yield { kind: "write", position: (y * image.width + x) * 4, data };
    }
}
