import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Legacy DDS header with one uncompressed 32-bit RGB(A) surface. */
function ddsHeader(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">): Uint8Array {
    const header = new Uint8Array(128), view = new DataView(header.buffer);
    header.set([0x44, 0x44, 0x53, 0x20]);
    view.setUint32(4, 124, true);
    view.setUint32(8, 0x100f, true); // caps, height, width, pitch, pixel format
    view.setUint32(12, image.height, true);
    view.setUint32(16, image.width, true);
    view.setUint32(20, image.width * 4, true);
    view.setUint32(76, 32, true);
    view.setUint32(80, image.hasAlpha ? 0x41 : 0x40, true); // RGB, optional alpha
    view.setUint32(88, 32, true);
    view.setUint32(92, 0xff, true);
    view.setUint32(96, 0xff00, true);
    view.setUint32(100, 0xff0000, true);
    view.setUint32(104, image.hasAlpha ? 0xff000000 : 0, true);
    view.setUint32(108, 0x1000, true); // texture
    return header;
}

export function encodeDdsImage(image: RgbaImage): Uint8Array {
    const output = new Uint8Array(128 + image.width * image.height * 4);
    output.set(ddsHeader(image));
    output.set(image.data.subarray(0, image.width * image.height * 4), 128);
    return output;
}

export async function* encodeDdsFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    signal.throwIfAborted();
    yield ddsHeader(image);
    const size = image.width * image.height * 4;
    for (let offset = 0; offset < size; offset += 4096) {
        await yieldTurn(signal);
        const length = Math.min(4096, size - offset);
        const data = await storage.read(image.position + offset, length, { signal });
        if (data.length !== length) throw new Error("Truncated DDS pixel storage");
        yield data;
    }
}
