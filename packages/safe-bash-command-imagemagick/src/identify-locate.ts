import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { IdentifyRaster } from "./identify-file.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { formatSignificantMetric } from "./compare-kernel.js";

export function* identifyMaximumSteps(image: Pick<RgbaImage, "width" | "height" | "space" | "hasAlpha">, limit: number, precision: number): Generator<{ position: number; length: number } | undefined, string, Uint8Array | Uint16Array | undefined> {
    const names = image.space === "b-w" ? ["Gray"] : ["Red", "Green", "Blue"];
    const channels = image.space === "b-w" ? [0] : [0, 1, 2];
    if (image.hasAlpha) { names.push("Alpha"); channels.push(3); }
    const maxima = channels.map(() => -Infinity), positions = channels.map(() => ""), counts = channels.map(() => 0);
    // Find the final maxima before collecting locations, so a small limit also bounds output memory.
    for (let pass = 0; pass < 2; pass++) {
        for (let position = 0; position < image.width * image.height * 4; position += 4096) {
            yield;
            const length = Math.min(4096, image.width * image.height * 4 - position);
            const samples = yield { position, length };
            if (!samples || samples.length !== length) throw new Error("Truncated maximum-location pixels");
            const scale = samples instanceof Uint16Array ? 1 : 257;
            for (let i = 0; i < length; i += 4) {
                for (let c = 0; c < channels.length; c++) {
                    const value = samples[i + channels[c]!]! * scale;
                    if (pass === 0) maxima[c] = Math.max(maxima[c]!, value);
                    else if (value === maxima[c] && (!limit || counts[c]! < limit)) {
                        const pixel = (position + i) / 4;
                        positions[c] += ` ${pixel % image.width},${Math.floor(pixel / image.width)}`;
                        counts[c]!++;
                    }
                }
            }
        }
    }
    return "Channel maximum locations:\n" + names.map((name, c) =>
        `  ${name}: ${formatSignificantMetric(maxima[c]!, precision)} (${formatSignificantMetric(maxima[c]! / 65535, precision)})${positions[c]}\n`).join("");
}

export async function identifyStoredMaximum({ image, storage }: IdentifyRaster, limit: number, precision: number, signal?: AbortSignal): Promise<string> {
    const steps = identifyMaximumSteps(image, limit, precision);
    let next = steps.next();
    while (!next.done) {
        signal?.throwIfAborted();
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else {
            const { position, length } = next.value, size = image.storedData16 ? 2 : 1;
            const bytes = await storage.read((image.storedData16?.position ?? image.position) + position * size, length * size, signal ? { signal } : undefined);
            next = steps.next(size === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        }
    }
    return next.value;
}
