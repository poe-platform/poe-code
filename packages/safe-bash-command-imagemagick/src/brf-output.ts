import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

const brailleAscii = " A1B'K2L@CIF/MSP\"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=";

/** Input has already undergone the same bilevel conversion as PBM. */
function* brfChunks(image: Pick<RgbaImage, "width" | "height" | "properties" | "virtualCanvas">): Generator<Uint8Array | { offset: number; length: number }, void, Uint8Array> {
    const label = image.properties?.label, page = image.virtualCanvas;
    yield new TextEncoder().encode(`${label === undefined ? "" : `Title: ${label}\n`}${page?.x ? `X: ${page.x}\n` : ""}${page?.y ? `Y: ${page.y}\n` : ""}Width: ${image.width + image.width % 2}\nHeight: ${image.height}\n\n`);
    for (let y = 0; y < image.height; y += 3) {
        for (let x = 0; x < image.width; x += 2048) {
            const end = Math.min(x + 2048, image.width), cells = new Uint8Array(Math.ceil((end - x) / 2));
            for (let dy = 0; dy < Math.min(3, image.height - y); dy++) {
                // Native 7.1.2's bilevel cache advances half a pixel per dot,
                // restarting at the source row for each three-row cell block.
                const start = y * image.width + Math.floor((x + dy * image.width + 1) / 2);
                const stop = y * image.width + Math.floor((end + dy * image.width) / 2) + 1;
                const data = yield { offset: start * 4, length: (stop - start) * 4 };
                for (let column = x; column < end; column++) {
                    const pixel = y * image.width + Math.floor((column + dy * image.width + 1) / 2);
                    if (data[(pixel - start) * 4]! < 128) cells[Math.floor((column - x) / 2)]! |= 1 << (dy + (column % 2) * 3);
                }
            }
            for (let cell = 0; cell < cells.length; cell++) cells[cell] = brailleAscii.charCodeAt(cells[cell]!);
            yield cells;
        }
        yield new Uint8Array([10]);
    }
}

export function encodeBrfImage(image: RgbaImage): Uint8Array {
    const steps = brfChunks(image), chunks: Uint8Array[] = [];
    let next = steps.next(), size = 0;
    while (!next.done) {
        if (next.value instanceof Uint8Array) { chunks.push(next.value); size += next.value.length; next = steps.next(); }
        else next = steps.next(image.data.subarray(next.value.offset, next.value.offset + next.value.length));
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
}

export async function* encodeBrfFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const steps = brfChunks(image);
    let next = steps.next();
    while (!next.done) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        if (next.value instanceof Uint8Array) { yield next.value; next = steps.next(); }
        else {
            const { offset, length } = next.value;
            const data = await storage.read(image.position + offset, length, { signal });
            if (data.length !== length) throw new Error("Truncated BRF pixel storage");
            next = steps.next(data);
        }
    }
}
