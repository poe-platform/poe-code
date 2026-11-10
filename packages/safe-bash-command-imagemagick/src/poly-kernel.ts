import type { RgbaImage } from "@poe-code/image-ast";
import type { ConvolveRequest } from "./convolve-kernel.js";

export function parseMagickPoly(value: string): number[] {
    const fields: string[] = [];
    const parts = value.split(",");
    for (const [index, part] of parts.entries()) {
        if (!part.trim() && index < parts.length - 1)
            throw new Error(`invalid list of numbers '-poly' '${value}'`);
        let field = "";
        for (const character of part) {
            if (character.trim() === "") {
                if (field) fields.push(field);
                field = "";
            } else {
                // Signs start the next term unless they belong to an exponent.
                const sign = (character === "+" || character === "-") && !field.endsWith("e") && !field.endsWith("E");
                const decimal = character === "." && (field.includes(".") || field.includes("e") || field.includes("E"));
                if (field && (sign || decimal)) {
                    fields.push(field);
                    field = "";
                }
                field += character;
            }
        }
        if (field) fields.push(field);
    }
    if (!fields.length || fields.some(part => !Number.isFinite(Number(part)) || Number.parseFloat(part) !== Number(part)))
        throw new Error(`invalid list of numbers '-poly' '${value}'`);
    // Native ignores an unmatched final coefficient and terms beyond the image list.
    return fields.slice(0, fields.length - fields.length % 2).map(Number);
}

export function* polyPixelSteps(size: number, inputs: readonly Pick<RgbaImage, "hasAlpha" | "space" | "format" | "depth">[], terms: readonly number[], channels?: readonly boolean[], highDepth = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const hasAlpha = inputs.some(image => image.hasAlpha);
    const colorOutput = inputs.some(image => image.space !== "b-w" && image.space !== "grey16");
    for (let position = 0; position < size; position += 4096) {
        yield;
        const length = Math.min(4096, size - position), values = new Float64Array(length);
        for (let image = 0; image < Math.min(inputs.length, terms.length / 2); image++) {
            yield;
            const evaluated = (yield { kind: "read", evaluate: true, image, position, length })!;
            const bytes = evaluated.length ? evaluated : (yield { kind: "read", highDepth, image, position, length })!;
            const samples = evaluated.length ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
            const range = !evaluated.length && highDepth ? 65535 : 255;
            const input = inputs[image]!;
            const gray = colorOutput && (input.space === "b-w" || input.space === "grey16");
            const colorSlots = gray ? 1 + Number(input.hasAlpha || (input.format === "png" && input.depth === "uchar")) : 3;
            for (let offset = 0; offset < length; offset++) {
                const channel = offset % 4;
                if (channels && !channels[channel] || (channel === 3 ? !input.hasAlpha || gray : channel >= colorSlots)) continue;
                values[offset]! += terms[image * 2]! * (samples[offset]! / range) ** terms[image * 2 + 1]!;
            }
        }
        for (let offset = 0; offset < length; offset++) values[offset] = offset % 4 === 3 && !hasAlpha ? 255 : values[offset]! * 255;
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(values.buffer) };
        // Keep Q16 output even when all sources were bytes; later encoders choose depth.
        const data = Uint16Array.from(values, value => Math.max(0, Math.min(65535, Math.round(value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(data.buffer) };
    }
}
