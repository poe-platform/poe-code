import { yieldTurn } from "safe-bash-contracts/yield";
import { decodeImageToStorage, tryPdfDecode, UnsupportedStoredResource, type ImageByteSource, type ImageByteStorage, type SharpInputOptions, type StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { FileSystem } from "@poe-code/safe-fs/contracts";

/** Raster file adapters keep PDF indexes and pixels in the caller's storage. */
export async function decodeFileImage(source: ImageByteSource, storage: ImageByteStorage, filesystem: FileSystem, cwd: string, signal: AbortSignal, options: SharpInputOptions): Promise<StoredRgbaImage> {
    try {
        return await decodeImageToStorage(source, storage, signal, options);
    } catch (error) {
        if (!(error instanceof UnsupportedStoredResource)) throw error;
        const pdf = await tryPdfDecode(source, storage, filesystem, cwd, signal, options);
        if (pdf) return pdf;
        return rejectUnknownImage(source, signal);
    }
}

/** Preserve read failures and cancellation while discarding unknown input in bounded chunks. */
export async function rejectUnknownImage(source: ImageByteSource, signal: AbortSignal): Promise<never> {
    for (let position = 0; position < source.size; position += 16384) {
        await yieldTurn(signal);
        await source.read(position, Math.min(16384, source.size - position), { signal });
    }
    signal.throwIfAborted();
    throw new Error("Input buffer contains unsupported image format");
}
