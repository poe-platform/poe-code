import type { RgbaColor } from "@poe-code/image-ast";
import type { ConvolveRequest } from "./convolve-kernel.js";

// Color drawing copies fill components into working channels, including C/M/Y.
// CMYK black is a separate channel and is not part of an RGB fill.
export function paintWorkingPixel(data: Uint8Array | Uint16Array, offset: number, scale: number, color: RgbaColor, cmyk: boolean, hue?: Float64Array, evaluate?: Float64Array, alphaOnly = false, channels?: readonly boolean[]): void {
    const paint = [color.r, color.g, color.b, color.a];
    for (let channel = alphaOnly ? 3 : 0; channel < 4; channel++) {
        if (channels && !channels[channel]) continue;
        const value = paint[channel]!;
        data[offset + channel] = Math.round(value * scale);
        if (evaluate) evaluate[offset + channel] = value;
        if (hue && (!cmyk || channel < 3)) hue[offset + channel] = value / 255;
    }
    if (cmyk && hue && !alphaOnly) {
        for (let channel = 0; channel < 3; channel++) {
            const value = (1 - hue[offset + channel]!) * (1 - hue[offset + 3]!) * 255;
            data[offset + channel] = Math.round(value * scale);
            if (evaluate) evaluate[offset + channel] = value;
        }
    }
}

export function* paintWorkingChunk(position: number, data: Uint8Array | Uint16Array, selected: Uint8Array, color: RgbaColor, cmyk: boolean, alphaOnly: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const hueBytes = yield { kind: "read", position, length: data.length, hue: true };
    const evaluateBytes = yield { kind: "read", position, length: data.length, evaluate: true };
    const hue = hueBytes?.length ? new Float64Array(hueBytes.slice().buffer) : undefined;
    const evaluate = evaluateBytes?.length ? new Float64Array(evaluateBytes.slice().buffer) : undefined;
    for (let i = 0; i < selected.length; i++) if (selected[i])
        paintWorkingPixel(data, i * 4, data instanceof Uint16Array ? 257 : 1, color, cmyk, hue, evaluate, alphaOnly);
    if (hue) yield { kind: "write", position, data: new Uint8Array(hue.buffer), hue: true };
    if (evaluate) yield { kind: "write", position, data: new Uint8Array(evaluate.buffer), evaluate: true };
}
