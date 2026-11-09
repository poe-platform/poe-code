import { parseXmlSteps } from "@poe-code/safe-fs/xml";
import type { RgbaImage } from "@poe-code/image-ast/portable";

interface ColorCorrection {
    slope: number[];
    offset: number[];
    power: number[];
    saturation: number;
}

export function* parseCdlSteps(bytes: Uint8Array): Generator<void, ColorCorrection, void> {
    const parser = parseXmlSteps(new TextDecoder().decode(bytes));
    let step = parser.next();
    while (!step.done) { yield; step = parser.next(); }
    const correction = step.value.children.find(child => child.name === "ColorCorrection");
    const sop = correction?.children.find(child => child.name === "SOPNode");
    const coefficients = (name: string, fallback: number) => {
        const text = sop?.children.find(child => child.name === name)?.text ?? "";
        const values = text.replaceAll(",", " ").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", " ").split(" ").filter(Boolean);
        return [0, 1, 2].map(index => values[index] === undefined ? fallback : Number.parseFloat(values[index]!));
    };
    const saturation = correction?.children.find(child => child.name === "SATNode")?.children.find(child => child.name === "Saturation");
    return { slope: coefficients("Slope", 1), offset: coefficients("Offset", 0), power: coefficients("Power", 1),
        saturation: correction ? saturation ? Number.parseFloat(saturation.text) : 0 : 1 };
}

export function* cdlImageSteps<T extends RgbaImage>(image: T, grade: ColorCorrection): Generator<void, T, void> {
    const data = image.data.slice(), data16 = image.data16?.slice();
    const input = image.data16 ?? image.data, range = image.data16 ? 65535 : 255;
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        const luma = 0.21267 * input[offset]! + 0.71526 * input[offset + 1]! + 0.07217 * input[offset + 2]!;
        for (let channel = 0; channel < 3; channel++) {
            const corrected = Math.max(0, Math.min(range, range * Math.pow(grade.slope[channel]! * input[offset + channel]! / range + grade.offset[channel]!, grade.power[channel]!)));
            const value = Math.max(0, Math.min(range, luma + grade.saturation * (corrected - luma)));
            data[offset + channel] = Math.round(value * 255 / range);
            if (data16) data16[offset + channel] = Math.round(value);
        }
    }
    return { ...image, data, ...(data16 ? { data16 } : {}) };
}
