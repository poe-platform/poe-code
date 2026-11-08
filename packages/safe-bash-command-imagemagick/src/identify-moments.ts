import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { formatSignificantMetric } from "./compare-kernel.js";

type Read = { position: number; length: number };

// Two bounded scans: centroid first, then central moments about that centroid.
export function* identifyMomentsSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space" | "depth">, precision = 6): Generator<Read | undefined, string, Uint8Array | Uint16Array | undefined> {
    const names = image.space === "b-w" ? ["Gray"] : ["Red", "Green", "Blue"];
    const channels = image.space === "b-w" ? [0] : [0, 1, 2];
    if (image.hasAlpha) { names.push("Alpha"); channels.push(3); }
    const moments = Array.from({ length: channels.length + 1 }, () => ({ mass: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0, xxx: 0, xxy: 0, xyy: 0, yyy: 0 }));
    for (let pass = 0; pass < 2; pass++) {
        for (let position = 0; position < image.width * image.height * 4; position += 4096) {
            yield;
            const length = Math.min(4096, image.width * image.height * 4 - position);
            const samples = yield { position, length };
            if (!samples || samples.length !== length) throw new Error("Truncated moment pixels");
            const range = samples instanceof Uint16Array ? 65535 : 255;
            for (let i = 0; i < length; i += 4) {
                const pixel = (position + i) / 4, x = pixel % image.width, y = Math.floor(pixel / image.width);
                const values = channels.map(c => samples[i + c]! / range);
                values.push(values.reduce((sum, value) => sum + value, 0) / values.length);
                for (let c = 0; c < (pass === 0 ? values.length : channels.length); c++) {
                    const m = moments[c]!, value = values[c]!;
                    if (pass === 0) { m.mass += value; m.x += x * value; m.y += y * value; }
                    else {
                        const dx = x - m.x, dy = y - m.y;
                        m.xx += dx * dx * value; m.yy += dy * dy * value; m.xy += dx * dy * value;
                        m.xxx += dx ** 3 * value; m.xxy += dx * dx * dy * value;
                        m.xyy += dx * dy * dy * value; m.yyy += dy ** 3 * value;
                    }
                }
            }
        }
        if (pass === 0) for (const m of moments) { m.x /= Math.max(m.mass, 1e-12); m.y /= Math.max(m.mass, 1e-12); }
    }
    // Native combines each channel's central moments after centering that channel.
    const overall = moments[channels.length]!;
    for (const key of ["xx", "yy", "xy", "xxx", "xxy", "xyy", "yyy"] as const) {
        overall[key] = moments.slice(0, channels.length).reduce((sum, m) => sum + m[key], 0) / channels.length;
    }
    const f = (value: number) => formatSignificantMetric(value, precision);
    const scale = image.depth === "ushort" ? 65535 : 255;
    let text = "  Channel Hu moments:\n";
    for (let c = 0; c < (image.space === "b-w" ? names.length : moments.length); c++) {
        const m = moments[c]!, mass = Math.max(m.mass, 1e-12);
        const delta = Math.hypot(m.xx - m.yy, 2 * m.xy);
        const major = Math.sqrt(Math.max(0, 2 * (m.xx + m.yy + delta) / mass));
        const minor = Math.sqrt(Math.max(0, 2 * (m.xx + m.yy - delta) / mass));
        let angle = Math.atan2(2 * m.xy, m.xx - m.yy) * 90 / Math.PI;
        if (angle <= 0) angle += 180;
        const intensity = major * minor > 0 ? m.mass / (Math.PI * major * minor) : 0;
        const xx = m.xx / mass ** 2, yy = m.yy / mass ** 2, xy = m.xy / mass ** 2;
        const xxx = m.xxx / mass ** 2.5, xxy = m.xxy / mass ** 2.5, xyy = m.xyy / mass ** 2.5, yyy = m.yyy / mass ** 2.5;
        const a = xxx + xyy, b = xxy + yyy, d = xxx - 3 * xyy, e = 3 * xxy - yyy;
        const invariants = [xx + yy, (xx - yy) ** 2 + 4 * xy ** 2, d ** 2 + e ** 2, a ** 2 + b ** 2,
            d * a * (a * a - 3 * b * b) + e * b * (3 * a * a - b * b),
            (xx - yy) * (a * a - b * b) + 4 * xy * a * b,
            e * a * (a * a - 3 * b * b) - d * b * (3 * a * a - b * b),
            xy * (a * a - b * b) - (xx - yy) * a * b];
        if (c === names.length) text += "  Image moments:\n";
        text += `    ${names[c] ?? "Overall"}:\n      Centroid: ${f(m.x)},${f(m.y)}\n` +
            `      Ellipse Semi-Major/Minor axis: ${f(major)},${f(minor)}\n      Ellipse angle: ${f(angle)}\n` +
            `      Ellipse eccentricity: ${f(major > 0 ? Math.sqrt(Math.max(0, 1 - (minor / major) ** 2)) : 0)}\n` +
            `      Ellipse intensity: ${f(intensity * scale)} (${f(intensity)})\n`;
        const powers = [1, 2, 3, 3, 6, 4, 6, 4];
        for (let i = 0; i < invariants.length; i++) text += `      I${i + 1}: ${f(invariants[i]! / scale ** powers[i]!)} (${f(invariants[i]!)})\n`;
    }
    return text;
}

export async function identifyStoredMoments(image: StoredRgbaImage, storage: ImageByteStorage, precision: number, signal: AbortSignal): Promise<string> {
    const steps = identifyMomentsSteps(image, precision);
    let next = steps.next();
    while (!next.done) {
        signal.throwIfAborted();
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else {
            const { position, length } = next.value, size = image.storedData16 ? 2 : 1;
            const bytes = await storage.read((image.storedData16?.position ?? image.position) + position * size, length * size, { signal });
            next = steps.next(size === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        }
    }
    return next.value;
}
