import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Bilevel conversion runs before encoding. MONO has no header and pads each row. */
function* monoChunks(image: Pick<RgbaImage, "width" | "height">, endian = "lsb"): Generator<number | Uint8Array, void, Uint8Array> {
    let byte = 0, bit = 0;
    for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
        const data = yield offset, output: number[] = [];
        for (let i = 0; i < data.length; i += 4) {
            // Both endian settings pack LSB-first; MSB selects white=1 instead.
            if ((data[i]! < 128) === (endian === "lsb")) byte |= 1 << bit;
            bit++;
            if (bit === 8 || ((offset + i) / 4 + 1) % image.width === 0) {
                output.push(byte);
                byte = 0;
                bit = 0;
            }
        }
        yield Uint8Array.from(output);
    }
}

export function encodeMonoImage(image: RgbaImage, endian?: string): Uint8Array {
    const steps = monoChunks(image, endian), output = new Uint8Array(Math.ceil(image.width / 8) * image.height);
    let next = steps.next(), offset = 0;
    while (!next.done) {
        if (typeof next.value === "number") next = steps.next(image.data.subarray(next.value, next.value + 4096));
        else { output.set(next.value, offset); offset += next.value.length; next = steps.next(); }
    }
    return output;
}

export async function* encodeMonoFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, endian?: string): AsyncGenerator<Uint8Array> {
    const steps = monoChunks(image, endian);
    let next = steps.next();
    while (!next.done) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        if (typeof next.value === "number") {
            const length = Math.min(4096, image.width * image.height * 4 - next.value);
            const data = await storage.read(image.position + next.value, length, { signal });
            if (data.length !== length) throw new Error("Truncated MONO pixel storage");
            next = steps.next(data);
        } else { yield next.value; next = steps.next(); }
    }
}
