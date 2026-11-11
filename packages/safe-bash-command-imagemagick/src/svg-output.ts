import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Emit pixel runs as SVG shapes without a tracing delegate or external resources. */
function* svgChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">): Generator<number | Uint8Array, void, Uint8Array> {
    const encoder = new TextEncoder();
    yield encoder.encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" shape-rendering="crispEdges">\n`);
    for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
        const data = yield offset;
        const elements: string[] = [];
        for (let i = 0; i < data.length;) {
            const pixel = (offset + i) / 4, x = pixel % image.width, y = Math.floor(pixel / image.width);
            const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = image.hasAlpha ? data[i + 3]! : 255;
            let end = i + 4;
            while (end < data.length && x + (end - i) / 4 < image.width
                && data[end] === r && data[end + 1] === g && data[end + 2] === b
                && (!image.hasAlpha || data[end + 3] === a)) end += 4;
            if (a) elements.push(`<rect x="${x}" y="${y}" width="${(end - i) / 4}" height="1" fill="rgb(${r},${g},${b})"${a === 255 ? "" : ` fill-opacity="${a / 255}"`}/>\n`);
            i = end;
        }
        yield encoder.encode(elements.join(""));
    }
    yield encoder.encode("</svg>\n");
}

export function encodeSvgImage(image: RgbaImage): Uint8Array {
    const steps = svgChunks(image), chunks: Uint8Array[] = [];
    let next = steps.next(), size = 0;
    while (!next.done) {
        if (typeof next.value === "number") next = steps.next(image.data.subarray(next.value, next.value + 4096));
        else { chunks.push(next.value); size += next.value.length; next = steps.next(); }
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
}

export async function* encodeSvgFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const steps = svgChunks(image);
    let next = steps.next();
    while (!next.done) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        if (typeof next.value === "number") {
            const length = Math.min(4096, image.width * image.height * 4 - next.value);
            const data = await storage.read(image.position + next.value, length, { signal });
            if (data.length !== length) throw new Error("Truncated SVG pixel storage");
            next = steps.next(data);
        } else { yield next.value; next = steps.next(); }
    }
}
