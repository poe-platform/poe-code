import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

/** PAL packs pairs of YCbCr pixels as U, Y1, V, Y2, always at eight bits. */
function* palChunks(image: Pick<RgbaImage, "width" | "height">): Generator<number | Uint8Array, void, Float64Array> {
    let first: readonly number[] | undefined;
    for (let offset = 0; offset < image.width * image.height * 4; offset += 2048) {
        const samples = yield offset, output: number[] = [];
        for (let i = 0; i < samples.length; i += 4) {
            const pixel = [samples[i]!, samples[i + 1]!, samples[i + 2]!];
            const endOfRow = ((offset + i) / 4 + 1) % image.width === 0;
            if (!first && !endOfRow) { first = pixel; continue; }
            // Native widens odd rows with a black pixel before converting colorspace.
            const left = first ?? pixel, right = first ? pixel : [0, 0.5, 0.5];
            output.push(...[(left[1]! + right[1]!) / 2, left[0]!, (left[2]! + right[2]!) / 2, right[0]!]
                .map(value => Math.round(Math.max(0, Math.min(65535, Math.fround(value * 65535))) / 257)));
            first = undefined;
        }
        yield Uint8Array.from(output);
    }
}

export function encodePalImage(image: RgbaImage): Uint8Array {
    const steps = palChunks(image), output = new Uint8Array(Math.ceil(image.width / 2) * 4 * image.height);
    let next = steps.next(), offset = 0;
    while (!next.done) {
        if (typeof next.value === "number") next = steps.next(image.hueSamples!.subarray(next.value, next.value + 2048));
        else { output.set(next.value, offset); offset += next.value.length; next = steps.next(); }
    }
    return output;
}

export async function* encodePalFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const steps = palChunks(image);
    let next = steps.next();
    while (!next.done) {
        await yieldTurn(signal);
        if (typeof next.value === "number") {
            const length = Math.min(2048, image.width * image.height * 4 - next.value) * 8;
            const data = await storage.read(image.storedHueSamples! + next.value * 8, length, { signal });
            if (data.length !== length) throw new Error("Truncated PAL pixel storage");
            next = steps.next(new Float64Array(data.slice().buffer));
        } else { yield next.value; next = steps.next(); }
    }
}
