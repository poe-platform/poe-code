import { decodeImageToStorage, tryPdfDecode, UnsupportedStoredResource, UnsupportedImageFormat, type ImageByteSource, type ImageByteStorage, type SharpInputOptions, type StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { FileSystem } from "@poe-code/safe-fs/contracts";

/** Raster file adapters keep PDF indexes and pixels in the caller's storage. */
export async function decodeFileImage(source: ImageByteSource, storage: ImageByteStorage, filesystem: FileSystem, cwd: string, signal: AbortSignal, options: SharpInputOptions): Promise<StoredRgbaImage> {
    try {
        return await decodeImageToStorage(source, storage, signal, options);
    } catch (error) {
        if (!(error instanceof UnsupportedStoredResource) || error instanceof UnsupportedImageFormat) throw error;
        const pdf = await tryPdfDecode(source, storage, filesystem, cwd, signal, options);
        if (pdf) return pdf;
        throw error;
    }
}
