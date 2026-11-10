import { extractImageSteps, transformStoredImage, type ImageByteStorage, type RgbaImage, type StoredRgbaImage } from "@poe-code/image-ast/portable";

type Area = { left: number; top: number; width: number; height: number };

// Pixels outside a read mask are unselected; its crop need only retain the overlap.
export function* cropReadMaskSteps(mask: RgbaImage, area: Area): Generator<void, RgbaImage, void> {
    const width = Math.min(area.width, mask.width - area.left);
    const height = Math.min(area.height, mask.height - area.top);
    if (width > 0 && height > 0) return yield* extractImageSteps(mask, { ...area, width, height });
    return { width: 1, height: 1, channels: 4, hasAlpha: false, format: "png", space: "srgb", depth: "uchar", density: 72, data: new Uint8Array([0, 0, 0, 255]) };
}

export async function cropStoredReadMask(mask: StoredRgbaImage, area: Area, storage: ImageByteStorage, signal: AbortSignal): Promise<StoredRgbaImage> {
    signal.throwIfAborted();
    const width = Math.min(area.width, mask.width - area.left);
    const height = Math.min(area.height, mask.height - area.top);
    if (width > 0 && height > 0) return transformStoredImage(mask, storage, { kind: "extract", ...area, width, height }, signal);
    const position = storage.allocate(4);
    await storage.write(position, new Uint8Array([0, 0, 0, 255]), { signal });
    return { width: 1, height: 1, channels: 4, hasAlpha: false, format: "png", space: "srgb", depth: "uchar", density: 72, position };
}
