import { rgbToCmyk } from "./colorspace-cmyk.js";
import { borderPixels } from "./border.js";
import type { renderFontCaption } from "./font/caption.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function* polaroidPixels(image: Parameters<typeof borderPixels>[0], border: number, color: Parameters<typeof borderPixels>[3], caption?: ReturnType<typeof renderFontCaption>, channels?: readonly boolean[], writeMask = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    if (image.space === "cmyk" && !color.cmyk) {
        // Polaroid fills a canvas: native conforms its sRGB border through linear RGB.
        const rgb = [color.r, color.g, color.b].map(value => value / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        color = { ...color, cmyk: rgbToCmyk(rgb[0]!, rgb[1]!, rgb[2]!) };
    }
    const frame = borderPixels(image, border, border, color, true, border + (caption?.height ?? 0), channels);
    // The resized native canvas has a zero write-mask channel. Activating alpha
    // then leaves its new samples transparent; an existing alpha channel survives.
    const alpha = writeMask ? !image.hasAlpha && color.a === 255 ? 0 : undefined : color.a !== 255 ? 255 : undefined;
    let response: Uint8Array | undefined;
    for (let step = frame.next(); !step.done; step = frame.next(response)) {
        const request = step.value;
        // Without a mask, native makes the composed canvas opaque before bending.
        if (alpha !== undefined && request?.kind === "write" && !(request.hue && image.space === "cmyk")) {
            const samples = request.evaluate || request.hue ? new Float64Array(request.data.buffer, request.data.byteOffset, request.data.byteLength / 8)
                : new Uint16Array(request.data.buffer, request.data.byteOffset, request.data.byteLength / 2);
            for (let i = 3; i < samples.length; i += 4) samples[i] = alpha * (request.hue ? 1 / 255 : request.evaluate ? 1 : 257);
        }
        response = yield request;
    }
    if (!caption) return;
    const width = image.width + 2 * border, top = image.height + Math.floor(3 * border / 2);
    for (let y = 0; y < caption.height; y++) for (let x = 0; x < caption.width; x += 1024) {
        yield;
        const count = Math.min(1024, caption.width - x);
        const samples = caption.pixels.slice((y * caption.width + x) * 4, (y * caption.width + x + count) * 4);
        if (channels) {
            const background = [color.r, color.g, color.b, color.a];
            for (let i = 0; i < samples.length; i++) if (!channels[i % 4]) samples[i] = background[i % 4]!;
        }
        if (writeMask && alpha !== undefined) for (let i = 3; i < samples.length; i += 4) samples[i] = alpha;
        const data = Uint16Array.from(samples, value => Math.round(value * 257));
        const position = ((top + y) * width + border + x) * 4;
        yield { kind: "write", position, data: new Uint8Array(data.buffer), highDepth: true };
        yield { kind: "write", position, data: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), evaluate: true };
    }
}
