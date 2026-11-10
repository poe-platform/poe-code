import type { ConvolveRequest } from "./convolve-kernel.js";

/** Source 0 is the extra plane; source 1 supplies the original gray-pixel test. */
export function* negateMetaPixelSteps(size: number, onlyGray: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let position = 0; position < size; position += 2048) {
        yield;
        const length = Math.min(2048, size - position);
        const working = yield { kind: "read", evaluate: true, position, length };
        const samples = working?.length ? new Float64Array(working.slice().buffer)
            : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, position, length })!.slice().buffer), value => value / 257);
        let colors: Float64Array | Uint16Array | undefined;
        if (onlyGray) {
            const hue = yield { kind: "read", hue: true, image: 1, position, length };
            const working = hue?.length ? hue : yield { kind: "read", evaluate: true, image: 1, position, length };
            colors = working?.length ? new Float64Array(working.slice().buffer)
                : new Uint16Array((yield { kind: "read", highDepth: true, image: 1, position, length })!.slice().buffer);
        }
        for (let offset = 0; offset < length; offset += 4) {
            if (colors && (colors[offset] !== colors[offset + 1] || colors[offset + 1] !== colors[offset + 2])) continue;
            for (let channel = 0; channel < 3; channel++) samples[offset + channel] = 255 - samples[offset + channel]!;
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
        const bounded = Uint16Array.from(samples, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
    }
}
