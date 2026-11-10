import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function parseComplexOperator(value: string | undefined): "add" | "subtract" {
    if (!value) throw new Error("missing argument '-complex'");
    const operation = value.toLowerCase();
    if (operation !== "add" && operation !== "subtract") throw new Error(`unsupported complex operator '${value}'`);
    return operation;
}

export function* complexPixelSteps(size: number, operation: "add" | "subtract", images: readonly Pick<RgbaImage, "space" | "hasAlpha">[], gray: boolean, grayOnly: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let position = 0; position < size; position += 4096) {
        yield;
        const length = Math.min(4096, size - position), inputs: Float64Array[] = [], inks: (Float64Array | undefined)[] = [];
        for (let image = 0; image < 2; image++) {
            const working = yield { kind: "read", evaluate: true, image, position, length };
            if (working?.length) inputs.push(new Float64Array(working.slice().buffer));
            else {
                const bytes = (yield { kind: "read", highDepth: true, image, position, length })!;
                inputs.push(Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257));
            }
            if (images[image]!.space === "cmyk") {
                const bytes = (yield { kind: "read", hue: true, image, position, length })!;
                inks[image] = new Float64Array(bytes.slice().buffer);
                for (let offset = 0; offset < length; offset++)
                    if (offset % 4 !== 3) inputs[image]![offset] = inks[image]![offset]! * 255;
            }
        }
        const samples = Float64Array.from(inputs[0]!, (value, offset) => {
            const channel = offset % 4;
            if (channel === 3 && !images[0]!.hasAlpha) return 255;
            // Native complex arithmetic requires the channel in every component.
            // Gray outputs store only red; mirror that result in our RGBA raster.
            if (channel === 1 || channel === 2) {
                if (gray) offset -= channel;
                else if (grayOnly) return value;
            }
            return operation === "add" ? inputs[0]![offset]! + inputs[1]![offset]!
                : inputs[0]![offset]! - inputs[1]![offset]!;
        });
        if (inks[0]) {
            // CMYK has four ink channels; alpha remains separate in the RGBA backing.
            const output = new Float64Array(length);
            for (let offset = 0; offset < length; offset += 4) {
                const black = inks[1]?.[offset + 3] ?? 0;
                output[offset + 3] = operation === "add" ? inks[0][offset + 3]! + black : inks[0][offset + 3]! - black;
                for (let channel = 0; channel < 3; channel++) {
                    output[offset + channel] = samples[offset + channel]! / 255;
                    samples[offset + channel] = (255 - samples[offset + channel]!) * (1 - output[offset + 3]!);
                }
            }
            yield { kind: "write", hue: true, position, data: new Uint8Array(output.buffer) };
        }
        const encoded = Uint16Array.from(samples, value => Math.max(0, Math.min(65535, Math.round(value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(encoded.buffer) };
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
    }
}
