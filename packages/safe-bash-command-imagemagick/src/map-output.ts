import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Palette conversion runs before encoding; MAP stores RGB bytes then one-byte indices. */
function* mapChunks(image: Pick<RgbaImage, "width" | "height" | "indexedColors" | "pngPalette" | "hasAlpha">): Generator<number | Uint8Array, void, Uint8Array> {
    const colors = image.indexedColors ?? (image.pngPalette && Array.from({ length: image.pngPalette.bytes.length / 3 }, (_, index) => {
        const { bytes, transparency } = image.pngPalette!;
        return (transparency?.[index] ?? 255) * 16777216 + bytes[index * 3]! * 65536 + bytes[index * 3 + 1]! * 256 + bytes[index * 3 + 2]!;
    }));
    if (!colors?.length || colors.length > 256) throw new Error("MAP output requires a palette of at most 256 colors");
    const palette = new Uint8Array(colors.length * 3), indices = new Map<number, number>();
    for (let index = 0; index < colors.length; index++) {
        const color = colors[index]!;
        palette.set([color >>> 16 & 255, color >>> 8 & 255, color & 255], index * 3);
        indices.set(image.hasAlpha ? color : color & 0xffffff, index);
    }
    yield palette;
    for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
        const data = yield offset, output = new Uint8Array(data.length / 4);
        for (let i = 0; i < data.length; i += 4) {
            const color = (image.hasAlpha ? data[i + 3]! * 16777216 : 0) + data[i]! * 65536 + data[i + 1]! * 256 + data[i + 2]!;
            const index = indices.get(color);
            if (index === undefined) throw new Error("MAP pixel is missing from the palette");
            output[i / 4] = index;
        }
        yield output;
    }
}

export function encodeMapImage(image: RgbaImage): Uint8Array {
    const steps = mapChunks(image), output = new Uint8Array((image.indexedColors ? image.indexedColors.length * 3 : image.pngPalette?.bytes.length ?? 0) + image.width * image.height);
    let next = steps.next(), offset = 0;
    while (!next.done) {
        if (typeof next.value === "number") next = steps.next(image.data.subarray(next.value, next.value + 4096));
        else { output.set(next.value, offset); offset += next.value.length; next = steps.next(); }
    }
    return output;
}

export async function* encodeMapFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const steps = mapChunks(image);
    let next = steps.next();
    while (!next.done) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        if (typeof next.value === "number") {
            const length = Math.min(4096, image.width * image.height * 4 - next.value);
            const data = await storage.read(image.position + next.value, length, { signal });
            if (data.length !== length) throw new Error("Truncated MAP pixel storage");
            next = steps.next(data);
        } else { yield next.value; next = steps.next(); }
    }
}
