import { stringify } from "yaml";
import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";
import { magickInput, type MagickFormatContext } from "./stored-stack.js";

type DescriptionImage = Pick<RgbaImage, "width" | "height" | "format" | "space" | "bitsPerSample" | "depth" | "isPalette" | "virtualCanvas" | "properties"> & HueMetadata & { [magickInput]?: MagickFormatContext };

export interface ImageDescriptionOutput {
    path: string;
    format: "json" | "yaml";
}

export function imageDescriptionOutput(spec: string): ImageDescriptionOutput | undefined {
    const lower = spec.toLowerCase();
    for (const format of ["json", "yaml"] as const) {
        if (lower.startsWith(`${format}:`)) return { path: spec.slice(5), format };
        if (!spec.includes(":") && lower.endsWith(`.${format}`)) return { path: spec, format };
    }
    return undefined;
}

export function imageDescription(image: DescriptionImage, properties: Record<string, string>, channelStatistics: Record<string, Record<string, number>>, depth?: number, format: ImageDescriptionOutput["format"] = "json"): string {
    const source = image[magickInput];
    const filePath = source?.filePath ?? "";
    const description = {
        version: format === "json" ? "1.0" : 1.0,
        image: {
            name: source?.inputFormat === "XC" ? `xc:${filePath}` : filePath,
            baseName: filePath.slice(filePath.lastIndexOf("/") + 1),
            format: source?.inputFormat ?? image.format.toUpperCase(),
            class: image.isPalette ? "PseudoClass" : "DirectClass",
            geometry: { width: image.width, height: image.height, x: 0, y: 0 },
            colorspace: image.magickColorspace ?? (image.space === "cmyk" ? "CMYK" : image.space === "b-w" || image.space === "grey16" ? "Gray" : "sRGB"),
            type: properties.type,
            depth: Number(properties["bit-depth"]),
            pixels: image.width * image.height,
            channelStatistics,
            baseDepth: depth ?? image.bitsPerSample ?? (image.depth === "ushort" ? 16 : 8),
            ...(image.virtualCanvas ? { pageGeometry: image.virtualCanvas } : {}),
            ...(image.properties ? { properties: image.properties } : {})
        }
    };
    return format === "json" ? JSON.stringify(description, null, 2) : `---\n${stringify(description)}`;
}
