import type { ConvolveRequest } from "./convolve-kernel.js";

export function parseComplexOperator(value: string | undefined): "add" | "subtract" {
    if (!value) throw new Error("missing argument '-complex'");
    const operation = value.toLowerCase();
    if (operation !== "add" && operation !== "subtract") throw new Error(`unsupported complex operator '${value}'`);
    return operation;
}

export function* complexPixelSteps(size: number, operation: "add" | "subtract", hasAlpha: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let position = 0; position < size; position += 4096) {
        yield;
        const length = Math.min(4096, size - position), inputs: Float64Array[] = [];
        for (let image = 0; image < 2; image++) {
            const working = yield { kind: "read", evaluate: true, image, position, length };
            if (working?.length) inputs.push(new Float64Array(working.slice().buffer));
            else {
                const bytes = (yield { kind: "read", highDepth: true, image, position, length })!;
                inputs.push(Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257));
            }
        }
        const samples = Float64Array.from(inputs[0]!, (value, offset) => offset % 4 === 3 && !hasAlpha ? 255
            : operation === "add" ? value + inputs[1]![offset]! : value - inputs[1]![offset]!);
        const encoded = Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(encoded.buffer) };
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
    }
}
