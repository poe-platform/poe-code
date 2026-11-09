import type { RgbaImage } from "@poe-code/image-ast";

export function magickResizeCanvas(image: Pick<RgbaImage, "width" | "height" | "virtualCanvas">, width: number, height: number) {
    const page = image.virtualCanvas;
    if (!page) return undefined;
    let scaleX = width / image.width, scaleY = height / image.height;
    const pageWidth = Math.floor(scaleX * page.width + 0.5), pageHeight = Math.floor(scaleY * page.height + 0.5);
    // CloneImage uses the smaller ratio for offsets when the ratios differ by less than two.
    if (Math.abs(scaleX - scaleY) < 2) scaleX = scaleY = Math.min(scaleX, scaleY);
    return { width: pageWidth, height: pageHeight, x: Math.ceil(scaleX * page.x - 0.5), y: Math.ceil(scaleY * page.y - 0.5) };
}
