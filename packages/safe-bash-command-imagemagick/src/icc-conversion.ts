import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";

type Curve = (value: number) => number;

/** ICC matrix/shaper profiles express linear RGB in the D50 XYZ connection space. */
function readProfile(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fail = (): never => { throw new Error("invalid or unsupported ICC color profile"); };
    if (bytes.length < 132 || view.getUint32(0) > bytes.length || view.getUint32(36) !== 0x61637370) fail();
    const size = view.getUint32(0), count = view.getUint32(128);
    if (size < 132 || count > (size - 132) / 12 || view.getUint32(20) !== 0x58595a20) fail();
    const tags = new Map<string, DataView>();
    for (let index = 0; index < count; index++) {
        const entry = 132 + index * 12, offset = view.getUint32(entry + 4), length = view.getUint32(entry + 8);
        if (offset < 132 + count * 12 || length < 8 || offset + length > size) fail();
        tags.set(String.fromCharCode(...bytes.subarray(entry, entry + 4)), new DataView(bytes.buffer, bytes.byteOffset + offset, length));
    }
    // LUT profiles need a different transform; never silently substitute a matrix approximation.
    if (["A2B0", "B2A0", "D2B0", "B2D0"].some(tag => tags.has(tag))) fail();
    const tag = (name: string, length: number) => {
        const data = tags.get(name);
        if (!data || data.byteLength < length) return fail();
        return data;
    };
    const xyz = (name: string) => {
        const data = tag(name, 20);
        if (data.getUint32(0) !== 0x58595a20) fail();
        return [8, 12, 16].map(offset => data.getInt32(offset) / 65536);
    };
    const curve = (name: string): Curve => {
        const data = tag(name, 12), type = data.getUint32(0);
        if (type === 0x63757276) {
            const length = data.getUint32(8);
            if (length > (data.byteLength - 12) / 2) fail();
            if (length === 0) return value => value;
            if (length === 1) {
                const gamma = data.getUint16(12) / 256;
                if (gamma === 0) fail();
                return value => value ** gamma;
            }
            const values = Array.from({ length }, (_, index) => data.getUint16(12 + index * 2) / 65535);
            if (values.some((value, index) => index > 0 && value < values[index - 1]!)) fail();
            return value => {
                const position = Math.max(0, Math.min(1, value)) * (length - 1), index = Math.min(length - 2, Math.floor(position));
                return values[index]! + (values[index + 1]! - values[index]!) * (position - index);
            };
        }
        if (type !== 0x70617261) return fail();
        const kind = data.getUint16(8), lengths = [1, 3, 4, 5, 7];
        if (kind > 4 || data.byteLength < 12 + lengths[kind]! * 4) fail();
        const parameters = Array.from({ length: lengths[kind]! }, (_, index) => data.getInt32(12 + index * 4) / 65536);
        const [g = 1, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = parameters;
        if (g <= 0 || a <= 0) fail();
        return value => kind === 0 ? value ** g
            : kind === 1 ? value >= -b / a ? (a * value + b) ** g : 0
            : kind === 2 ? value >= -b / a ? (a * value + b) ** g + c : c
            : kind === 3 ? value >= d ? (a * value + b) ** g : c * value
            : value >= d ? (a * value + b) ** g + e : c * value + f;
    };
    const gray = view.getUint32(16) === 0x47524159;
    if (!gray && view.getUint32(16) !== 0x52474220) fail();
    const curves = gray ? [curve("kTRC")] : [curve("rTRC"), curve("gTRC"), curve("bTRC")];
    const matrix = gray ? [xyz("wtpt")] : [xyz("rXYZ"), xyz("gXYZ"), xyz("bXYZ")];
    return { gray, curves, matrix };
}

export function createIccConversion(source: Uint8Array, destination: Uint8Array) {
    if (source.length === destination.length && source.every((byte, index) => byte === destination[index])) {
        return function* (image: RgbaImage): Generator<void, RgbaImage, void> { yield; return { ...image, icc: destination }; };
    }
    const from = readProfile(source), to = readProfile(destination);
    const inverse = to.gray ? [] : (() => {
        const [r, g, b] = to.matrix as [number[], number[], number[]];
        const [a, d, g0] = r as [number, number, number], [b0, e, h] = g as [number, number, number], [c, f, i] = b as [number, number, number];
        const det = a * (e * i - f * h) - b0 * (d * i - f * g0) + c * (d * h - e * g0);
        if (Math.abs(det) < 1e-12) throw new Error("invalid ICC color matrix");
        return [[e * i - f * h, c * h - b0 * i, b0 * f - c * e], [f * g0 - d * i, a * i - c * g0, c * d - a * f], [d * h - e * g0, b0 * g0 - a * h, a * e - b0 * d]].map(row => row.map(value => value / det));
    })();
    // Precompute destination encodings once, including sampled and parametric TRCs.
    const encodings = to.curves.map(curve => {
        const table = new Float64Array(65536);
        let upperIndex = 1, lower = curve(0), upper = curve(1 / 65535);
        if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper < lower) throw new Error("invalid ICC tone curve");
        for (let index = 0; index < table.length; index++) {
            const value = index / 65535;
            while (upper < value && upperIndex < 65535) {
                lower = upper;
                upper = curve(++upperIndex / 65535);
                if (!Number.isFinite(upper) || upper < lower) throw new Error("invalid ICC tone curve");
            }
            table[index] = value <= lower ? (upperIndex - 1) / 65535 : value >= upper ? upperIndex / 65535
                : (upperIndex - 1 + (value - lower) / (upper - lower)) / 65535;
        }
        return table;
    });
    return function* convert(image: RgbaImage & HueMetadata): Generator<void, RgbaImage, void> {
        const { data16: old16, evaluateSamples, hueSamples: ignoredHue, dataFloat: ignoredFloat, magickColorspace: ignoredSpace, ...metadata } = image;
        const input = evaluateSamples ?? old16 ?? image.data, range = evaluateSamples ? 255 : old16 ? 65535 : 255;
        const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
        for (let offset = 0; offset < data.length; offset += 4) {
            if (offset % 16384 === 0) yield;
            const xyz = [0, 0, 0];
            for (let channel = 0; channel < from.curves.length; channel++) {
                const linear = from.curves[channel]!(Math.max(0, Math.min(1, input[offset + channel]! / range)));
                for (let axis = 0; axis < 3; axis++) xyz[axis]! += from.matrix[channel]![axis]! * linear;
            }
            for (let channel = 0; channel < 3; channel++) {
                const linear = to.gray ? xyz[1]! / to.matrix[0]![1]! : inverse[channel]!.reduce((sum, coefficient, axis) => sum + coefficient * xyz[axis]!, 0);
                const table = encodings[to.gray ? 0 : channel]!;
                const value = table[Math.round(Math.max(0, Math.min(1, linear)) * 65535)]!;
                data[offset + channel] = Math.round(value * 255);
                data16[offset + channel] = Math.round(value * 65535);
            }
            data[offset + 3] = image.data[offset + 3]!;
            data16[offset + 3] = old16?.[offset + 3] ?? image.data[offset + 3]! * 257;
        }
        return { ...metadata, data, data16, icc: destination, space: to.gray ? "b-w" : "srgb", channels: to.gray ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3 };
    };
}
