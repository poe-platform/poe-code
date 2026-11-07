import type { CompareImage, CompareRequest, CompareSamples } from "./compare-kernel.js";

// ImageMagick's default PHASH: seven Hu invariants in xyY and HSB after
// a separable sigma=1 blur. Keep only a bounded halo, repeating reads for
// the centroid and central-moment passes instead of retaining whole images.
export function* perceptualHashSteps(info: CompareImage, image: 0 | 1, selected: readonly number[] = [0, 1, 2, 3]): Generator<CompareRequest | undefined, number[], CompareSamples | undefined> {
    const weights = Array.from({ length: 9 }, (_, i) => {
        let sum = 0;
        for (let sub = -1; sub <= 1; sub++) sum += Math.exp(-((3 * (i - 4) + sub) ** 2) / 18);
        return sum;
    });
    const total = weights.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < weights.length; i++) weights[i]! /= total;
    // Native RGBA PHASH compares color moments only; alpha still weights the blur.
    const moments = Array.from({ length: 6 }, () => ({ mass: 0, x: 0, y: 0, m11: 0, m20: 0, m02: 0, m21: 0, m12: 0, m30: 0, m03: 0 }));
    for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < info.height; y++) {
            for (let left = 0; left < info.width; left += 1016) {
                yield;
                const count = Math.min(1016, info.width - left);
                const start = Math.max(0, left - 4), end = Math.min(info.width, left + count + 4);
                const rows: Float32Array[] = [];
                for (let v = -4; v <= 4; v++) {
                    const row = Math.max(0, Math.min(info.height - 1, y + v));
                    const length = (end - start) * 4;
                    const data = yield { kind: "read", image, position: (row * info.width + start) * 4, length };
                    if (!data || data.length !== length) throw new Error("Truncated comparison pixels");
                    const blurred = new Float32Array(count * 4);
                    for (let x = 0; x < count; x++) {
                        let alpha = 0;
                        const sums = [0, 0, 0, 0];
                        for (let u = -4; u <= 4; u++) {
                            const offset = (Math.max(0, Math.min(info.width - 1, left + x + u)) - start) * 4;
                            const weight = weights[u + 4]!;
                            const opacity = info.hasAlpha ? data[offset + 3]! / 255 : 1;
                            alpha += weight * opacity;
                            for (let c = 0; c < 4; c++) sums[c]! += weight * data[offset + c]! * 257 * (c === 3 ? 1 : opacity);
                        }
                        for (let c = 0; c < 4; c++) blurred[x * 4 + c] = selected.includes(c) ? sums[c]! / (c === 3 ? 1 : Math.max(alpha, 1e-12)) : data[(left + x - start) * 4 + c]! * 257;
                    }
                    rows.push(blurred);
                }
                for (let x = 0; x < count; x++) {
                    const sums = [0, 0, 0, 0];
                    let alpha = 0;
                    for (let v = 0; v < 9; v++) {
                        const row = rows[v]!, weight = weights[v]!;
                        const opacity = info.hasAlpha ? row[x * 4 + 3]! / 65535 : 1;
                        alpha += weight * opacity;
                        for (let c = 0; c < 4; c++) sums[c]! += weight * row[x * 4 + c]! * (c === 3 ? 1 : opacity);
                    }
                    const rgba = sums.map((value, c) => (selected.includes(c) ? Math.fround(value / (c === 3 ? 1 : Math.max(alpha, 1e-12))) : rows[4]![x * 4 + c]!) / 65535);
                    const r = rgba[0]!, g = rgba[1]!, b = rgba[2]!;
                    const linear = [r, g, b].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
                    const lr = linear[0]!, lg = linear[1]!, lb = linear[2]!;
                    const X = 0.41239558896741424 * lr + 0.3575834307637148 * lg + 0.18049264738170157 * lb;
                    const Y = 0.21258623078559555 * lr + 0.7151703037034108 * lg + 0.07220049864333623 * lb;
                    const Z = 0.019297215491746945 * lr + 0.11918386458084854 * lg + 0.9504971251315798 * lb;
                    const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
                    let hue = delta === 0 ? 0 : (max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta) / 6;
                    if (hue < 0) hue++;
                    const values = [X / Math.max(X + Y + Z, 1e-12), Y / Math.max(X + Y + Z, 1e-12), Y, hue, max === 0 ? 0 : delta / max, max];
                    for (let c = 0; c < moments.length; c++) {
                        const quantum = Math.fround(values[c]! * 65535), value = (1 / 65535) * quantum, m = moments[c]!;
                        if (pass === 0) {
                            m.mass += value; m.x = multiplyAdd(left + x, value, m.x); m.y = multiplyAdd(y, value, m.y);
                        } else {
                            const dx = left + x - m.x, dy = y - m.y;
                            m.m11 = multiplyAdd(dx * dy * (1 / 65535), quantum, m.m11);
                            m.m20 = multiplyAdd(dx * dx * (1 / 65535), quantum, m.m20);
                            m.m02 = multiplyAdd(dy * dy * (1 / 65535), quantum, m.m02);
                            m.m21 = multiplyAdd(dx * dx * dy * (1 / 65535), quantum, m.m21);
                            m.m12 = multiplyAdd(dx * dy * dy * (1 / 65535), quantum, m.m12);
                            m.m30 = multiplyAdd(dx * dx * dx * (1 / 65535), quantum, m.m30);
                            m.m03 = multiplyAdd(dy * dy * dy * (1 / 65535), quantum, m.m03);
                        }
                    }
                }
            }
        }
        if (pass === 0) for (const m of moments) { m.x *= 1 / Math.max(m.mass, 1e-12); m.y *= 1 / Math.max(m.mass, 1e-12); }
    }
    return moments.flatMap(m => {
        const second = 1 / Math.max(m.mass ** 2, 1e-12), third = 1 / Math.max(m.mass ** 2.5, 1e-12);
        const m11 = m.m11 * second, m20 = m.m20 * second, m02 = m.m02 * second;
        const m21 = m.m21 * third, m12 = m.m12 * third, m30 = m.m30 * third, m03 = m.m03 * third;
        const a = m30 + m12, b = m21 + m03, c = multiplyAdd(-3, m12, m30), d = multiplyAdd(3, m21, -m03);
        return [m20 + m02, (m20 - m02) ** 2 + 4 * m11 * m11, c * c + d * d, a * a + b * b,
            c * a * (a * a - 3 * b * b) + d * b * (3 * a * a - b * b),
            (m20 - m02) * (a * a - b * b) + 4 * m11 * a * b,
            multiplyAdd(d * a, multiplyAdd(a, a, -3 * b * b), -c * b * multiplyAdd(3 * a, a, -b * b))
        ].map(value => -Math.log10(Math.max(Math.abs(value), Number.MIN_VALUE)));
    });
}

// Preserve the fused multiply-add rounding of native moment accumulation,
// especially near zero: PHASH takes logarithms of these small residuals.
function multiplyAdd(a: number, b: number, c: number): number {
    const product = a * b;
    const splitA = 134217729 * a, splitB = 134217729 * b;
    const highA = splitA - (splitA - a), highB = splitB - (splitB - b);
    const lowA = a - highA, lowB = b - highB;
    const error = ((highA * highB - product) + highA * lowB + lowA * highB) + lowA * lowB;
    const sum = product + c, delta = sum - product;
    return sum + ((product - (sum - delta)) + (c - delta) + error);
}
