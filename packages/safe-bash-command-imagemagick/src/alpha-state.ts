import type { ImageMetadata } from "@poe-code/image-ast/portable";

export function discardDisassociatedAlpha<T extends ImageMetadata & { inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined; alphaSeparate?: boolean | undefined }>(image: T): T {
    if (image.hasAlpha || image.inactiveAlpha !== true || image.alphaBlend !== false) return image;
    return { ...image, inactiveAlpha: false, alphaSeparate: false,
        channels: image.space === "cmyk" ? 4 : image.channels <= 2 ? 1 : 3 };
}
