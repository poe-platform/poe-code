import type { ConvolveRequest } from "./convolve-kernel.js";

export function manhattanDistanceScale(spec: string): number {
    const [name, parameters, extra] = spec.toLowerCase().split(":");
    const [radius = "1", rawScale, extraScale] = (parameters ?? "1").split(",");
    const normalized = rawScale?.endsWith("!") ?? false;
    const scale = rawScale === undefined ? 100 : Number(normalized ? rawScale.slice(0, -1) : rawScale);
    if (name !== "manhattan" || extra !== undefined || extraScale !== undefined
        || Number(radius) !== 1 || !Number.isFinite(scale) || scale <= 0)
        throw new Error(`unsupported distance kernel '${spec}'`);
    return normalized ? 65535 / (scale + 1) : scale;
}

/** Two raster sweeps compute the Manhattan minimum using one row of working memory. */
export function* distancePixelSteps(image: { width: number; height: number; hasAlpha?: boolean }, scale: number, reverse: boolean, channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, previous = new Float64Array(width * 4);
    previous.fill(65535);
    for (let row = 0; row < height; row++) {
        yield;
        const y = reverse ? height - 1 - row : row;
        const adjacent = [65535, 65535, 65535, 65535];
        for (let start = 0; start < width; start += 1024) {
            const count = Math.min(1024, width - start), left = reverse ? width - start - count : start;
            const position = (y * width + left) * 4;
            const bytes = yield { kind: "read", highDepth: true, position, length: count * 4 };
            if (!bytes || bytes.length !== count * 8) throw new Error("Truncated distance pixels");
            const data = new Uint16Array(bytes.slice().buffer);
            for (let column = 0; column < count; column++) {
                const x = reverse ? count - 1 - column : column;
                for (let channel = 0; channel < 4; channel++) {
                    if (channels ? !channels[channel] : channel === 3) continue;
                    if (channel === 3 && image.hasAlpha === false) continue;
                    const offset = x * 4 + channel, above = (left + x) * 4 + channel;
                    const value = Math.min(data[offset]!, previous[above]! + scale, adjacent[channel]! + scale);
                    previous[above] = adjacent[channel] = value;
                    data[offset] = Math.round(value);
                }
            }
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(data.buffer) };
        }
    }
}
