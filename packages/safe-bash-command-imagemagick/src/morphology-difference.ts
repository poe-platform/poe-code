import type { ConvolveRequest } from "./convolve-kernel.js";

/** Subtract two morphology results without losing their sample depth. */
export function* morphologyDifferencePixelSteps(size: number, hasAlpha: boolean, highDepth: boolean, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const maximum = highDepth ? 65535 : 255;
    for (let position = 0; position < size; position += 4096) {
        yield;
        const length = Math.min(4096, size - position);
        const left = yield { kind: "read", image: 0, highDepth, position, length };
        if (!left || left.length !== length * (highDepth ? 2 : 1)) throw new Error("Truncated morphology pixels");
        const data = highDepth ? new Uint16Array(left.slice().buffer) : left.slice();
        const right = yield { kind: "read", image: 1, highDepth, position, length };
        if (!right || right.length !== data.byteLength) throw new Error("Truncated morphology pixels");
        const samples = highDepth ? new Uint16Array(right.buffer, right.byteOffset, length) : right;
        for (let i = 0; i < length; i++) {
            if (channels && !channels[i % 4]) continue;
            data[i] = i % 4 === 3 && !hasAlpha ? maximum : Math.max(0, data[i]! - samples[i]!);
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    }
}
