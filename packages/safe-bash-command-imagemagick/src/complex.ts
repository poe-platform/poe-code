import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function parseComplexOperator(value: string | undefined): "add" | "subtract" | "conjugate" {
    if (!value) throw new Error("missing argument '-complex'");
    const operation = value.toLowerCase();
    if (operation === "undefined") return "conjugate";
    if (operation !== "add" && operation !== "subtract" && operation !== "conjugate") throw new Error(`unsupported complex operator '${value}'`);
    return operation;
}

export function* complexPixelSteps(extent: Pick<RgbaImage, "width" | "height">, operation: "add" | "subtract" | "conjugate", images: readonly Pick<RgbaImage, "width" | "height" | "space" | "hasAlpha">[], gray: boolean, grayOnly: boolean, part: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const base = images[0]!;
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width;) {
        yield;
        // Only the first pair bounds arithmetic; preserve original samples outside it.
        const active = x < extent.width && y < extent.height;
        const count = Math.min(1024, (active ? extent.width : base.width) - x);
        const position = (y * base.width + x) * 4, length = count * 4;
        const inputs: Float64Array[] = [], inks: (Float64Array | undefined)[] = [];
        x += count;
        for (let image = 0; image < (active && operation !== "conjugate" ? 2 : 1); image++) {
            const working = yield { kind: "read", evaluate: true, image, position, length };
            if (working?.length) inputs.push(new Float64Array(working.slice().buffer));
            else {
                const bytes = (yield { kind: "read", highDepth: true, image, position, length })!;
                inputs.push(Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257));
            }
            if (images[image]!.space === "cmyk") {
                const bytes = (yield { kind: "read", hue: true, image, position, length })!;
                inks[image] = new Float64Array(bytes.slice().buffer);
                if (active) for (let offset = 0; offset < length; offset++)
                    if (offset % 4 !== 3) inputs[image]![offset] = inks[image]![offset]! * 255;
            }
        }
        const samples = !active ? inputs[0]! : Float64Array.from(inputs[0]!, (value, offset) => {
            const channel = offset % 4;
            if (channel === 3 && !images[0]!.hasAlpha) return 255;
            if (operation !== "conjugate" && channel === 3 && !images[1]!.hasAlpha) return value;
            // Native complex arithmetic requires the channel in every component.
            // Gray outputs store only red; mirror that result in our RGBA raster.
            if (channel === 1 || channel === 2) {
                if (gray) offset -= channel;
                else if (grayOnly) return value;
            }
            if (operation === "conjugate") return part === 0 ? inputs[0]![offset]! : -inputs[0]![offset]!;
            return operation === "add" ? inputs[0]![offset]! + inputs[1]![offset]!
                : inputs[0]![offset]! - inputs[1]![offset]!;
        });
        if (inks[0]) {
            // CMYK has four ink channels; alpha remains separate in the RGBA backing.
            const output = new Float64Array(inks[0]);
            if (active) for (let offset = 0; offset < length; offset += 4) {
                const black = inks[1]?.[offset + 3] ?? 0;
                output[offset + 3] = operation === "conjugate" ? (part === 0 ? inks[0][offset + 3]! : -inks[0][offset + 3]!)
                    : operation === "add" ? inks[0][offset + 3]! + black : inks[0][offset + 3]! - black;
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
