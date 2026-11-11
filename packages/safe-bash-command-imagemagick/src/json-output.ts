import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";
import { magickInput, type MagickFormatContext } from "./stored-stack.js";

type JsonImage = Pick<RgbaImage, "width" | "height" | "format" | "space" | "bitsPerSample" | "depth" | "isPalette" | "virtualCanvas" | "properties"> & HueMetadata & { [magickInput]?: MagickFormatContext };

export function jsonOutputPath(spec: string): string | undefined {
    const lower = spec.toLowerCase();
    return lower.startsWith("json:") ? spec.slice(5) : !spec.includes(":") && lower.endsWith(".json") ? spec : undefined;
}

export function jsonImageDescription(image: JsonImage, depth?: number): string {
    const source = image[magickInput];
    return JSON.stringify({
        version: "1.0",
        image: {
            name: source?.filePath ?? "",
            format: source?.inputFormat ?? image.format.toUpperCase(),
            class: image.isPalette ? "PseudoClass" : "DirectClass",
            geometry: { width: image.width, height: image.height, x: 0, y: 0 },
            colorspace: image.magickColorspace ?? (image.space === "cmyk" ? "CMYK" : image.space === "b-w" || image.space === "grey16" ? "Gray" : "sRGB"),
            baseDepth: depth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8),
            ...(image.virtualCanvas ? { pageGeometry: image.virtualCanvas } : {}),
            ...(image.properties ? { properties: image.properties } : {})
        }
    }, null, 2);
}
