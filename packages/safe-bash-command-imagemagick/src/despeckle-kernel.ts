import type { ConvolveRequest } from "./convolve-kernel.js";

/** Directional hull smoothing with the native zero border and Q16 step size. */
export function* despecklePixelSteps(image: { width: number; height: number; hasAlpha: boolean }, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, stride = width + 2;
    const output = new Uint16Array(width * height * 4);
    for (let position = 0; position < output.length; position += 4096) {
        yield;
        const length = Math.min(4096, output.length - position);
        const bytes = yield { kind: "read", highDepth: true, position, length };
        if (!bytes || bytes.length !== length * 2) throw new Error("Truncated despeckle pixels");
        output.set(new Uint16Array(bytes.slice().buffer), position);
    }
    const pixels = new Uint16Array(stride * (height + 2));
    const buffer = new Uint16Array(pixels.length);
    let work = 0;
    for (let channel = 0; channel < (image.hasAlpha ? 4 : 3); channel++) {
        if (channels && !channels[channel]) continue;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (++work % 4096 === 0) yield;
            pixels[(y + 1) * stride + x + 1] = output[(y * width + x) * 4 + channel]!;
        }
        // Every hull has two stages. Only interior samples change; padding stays zero.
        for (const direction of [stride, 1, stride + 1, stride - 1]) {
            for (const [offset, polarity] of [[direction, 1], [-direction, 1], [-direction, -1], [direction, -1]] as const) {
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    if (++work % 4096 === 0) yield;
                    const i = (y + 1) * stride + x + 1, value = pixels[i]!;
                    buffer[i] = (pixels[i + offset]! - value) * polarity >= 514 ? value + polarity * 257 : value;
                }
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    if (++work % 4096 === 0) yield;
                    const i = (y + 1) * stride + x + 1, value = buffer[i]!;
                    pixels[i] = (buffer[i - offset]! - value) * polarity >= 514 && (buffer[i + offset]! - value) * polarity > 0
                        ? value + polarity * 257 : value;
                }
            }
        }
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (++work % 4096 === 0) yield;
            output[(y * width + x) * 4 + channel] = pixels[(y + 1) * stride + x + 1]!;
        }
    }
    for (let position = 0; position < output.length; position += 4096) {
        yield;
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(output.slice(position, position + 4096).buffer) };
    }
}
