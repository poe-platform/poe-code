import type { ConvolveRequest } from "./convolve-kernel.js";

/** Subtract two morphology results without losing their sample depth. */
export function* morphologyDifferencePixelSteps(size: number, hasAlpha: boolean, highDepth: boolean, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const maximum = highDepth ? 65535 : 255;
    for (let position = 0; position < size; position += 4096) {
        yield;
        const length = Math.min(4096, size - position);
        const leftWorking = yield { kind: "read", image: 0, evaluate: true, position, length };
        const rightWorking = yield { kind: "read", image: 1, evaluate: true, position, length };
        if (leftWorking?.length && rightWorking?.length) {
            const values = new Float64Array(leftWorking.slice().buffer);
            const samples = new Float64Array(rightWorking.slice().buffer);
            for (let i = 0; i < length; i++) {
                if (channels && !channels[i % 4]) continue;
                values[i] = i % 4 === 3 && !hasAlpha ? 255 : Math.max(0, values[i]! - samples[i]!);
            }
            const data = Uint16Array.from(values, value => Math.max(0, Math.min(65535, Math.round(value * 257))));
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(data.buffer) };
            yield { kind: "write", evaluate: true, position, data: new Uint8Array(values.buffer) };
            continue;
        }
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
