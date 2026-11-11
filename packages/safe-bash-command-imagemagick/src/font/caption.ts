import type { GravityPosition, RgbaColor } from "@poe-code/image-ast/portable";
import createFontRuntime from "./runtime.js";

export function wrapFontCaption(bytes: Uint8Array, text: string, width: number, pointsize: number, density: number, strokeWidth: number, signal?: AbortSignal, split = false): string[] {
    if (bytes.length > 16 * 1024 * 1024) throw new Error("font exceeds memory limit");
    signal?.throwIfAborted();
    const runtime = createFontRuntime();
    const pointer = runtime._malloc(bytes.length);
    if (!pointer) throw new Error("font exceeds memory limit");
    try {
        runtime.HEAPU8.set(bytes, pointer);
        if (runtime._font_open(pointer, bytes.length, pointsize, density, density)) throw new Error("unable to read font");
        const lines: string[] = [], chars = [...text];
        let start = 0, advance = 0, previous = 0, lastSpace = -1;
        for (let i = 0; i < chars.length; i++) {
            const char = chars[i]!;
            if (char === "\n") {
                lines.push(chars.slice(start, i).join(""));
                start = i + 1; advance = previous = 0; lastSpace = -1;
                continue;
            }
            signal?.throwIfAborted();
            const address = runtime._font_glyph(char.codePointAt(0)!);
            if (!address) throw new Error("unable to render font glyph");
            const at = address / 4;
            const values = { id: runtime.HEAP32[at + 7]!, advance: runtime.HEAP32[at + 6]! / 64 };
            advance += runtime._font_kerning(previous, values.id) / 64 + values.advance;
            previous = values.id;
            if (char === " " || char === "\t") lastSpace = i;
            if (Math.floor(advance + strokeWidth + 0.5) <= width) continue;
            if (lastSpace >= start) {
                lines.push(chars.slice(start, lastSpace).join(""));
                i = lastSpace; start = i + 1;
            } else if (split && i > start) {
                lines.push(chars.slice(start, i).join(""));
                start = i--;
            } else continue;
            advance = previous = 0; lastSpace = -1;
        }
        lines.push(chars.slice(start).join(""));
        return lines;
    } finally { runtime._font_close(); runtime._free(pointer); }
}

export function renderFontCaption(bytes: Uint8Array, text: string, width: number, pointsize: number, density: number, fill: RgbaColor, background: RgbaColor, strokeWidth: number, signal?: AbortSignal, layout?: { height?: number; wrap: boolean; gravity?: GravityPosition | undefined }) {
    if (bytes.length > 16 * 1024 * 1024) throw new Error("font exceeds memory limit");
    signal?.throwIfAborted();
    const runtime = createFontRuntime();
    const pointer = runtime._malloc(bytes.length);
    if (!pointer) throw new Error("font exceeds memory limit");
    try {
        runtime.HEAPU8.set(bytes, pointer);
        if (runtime._font_open(pointer, bytes.length, pointsize, density, density)) throw new Error("unable to read font");
        const metric = runtime._font_metrics() / 4;
        const ascent = runtime.HEAP32[metric]! / 64, descent = runtime.HEAP32[metric + 1]! / 64;
        const lineHeight = ascent - descent;
        const glyph = (char: string) => {
            signal?.throwIfAborted();
            const address = runtime._font_glyph(char.codePointAt(0)!);
            if (!address) throw new Error("unable to render font glyph");
            const at = address / 4, values = runtime.HEAP32;
            return { width: values[at]!, height: values[at + 1]!, pitch: values[at + 2]!, bitmap: values[at + 3]!,
                left: values[at + 4]!, top: values[at + 5]!, advance: values[at + 6]! / 64, id: values[at + 7]! };
        };
        const measure = (content: string) => {
            let advance = 0, previous = 0;
            for (const char of content) {
                const values = glyph(char);
                advance += runtime._font_kerning(previous, values.id) / 64 + values.advance;
                previous = values.id;
            }
            return advance;
        };
        if (width === 0) {
            for (const line of text.split("\n")) width = Math.max(width, Math.floor(measure(line) + strokeWidth + 0.5));
            width = Math.max(1, width);
        }
        const lines = layout?.wrap === false ? text.split("\n")
            : wrapFontCaption(bytes, text, width, pointsize, density, strokeWidth, signal, layout?.wrap === true && !layout.height);
        // Caption canvases include stroke width per line; baseline spacing does not.
        const height = layout?.height || Math.max(1, Math.floor(lines.length * (lineHeight + (layout?.wrap ? strokeWidth : 0)) + 0.5));
        if (!Number.isSafeInteger(width * height) || width * height > 2 ** 20) throw new Error("font caption exceeds pixel limit");
        const pixels = new Float64Array(width * height * 4);
        for (let i = 0; i < pixels.length; i += 4) pixels.set([background.r, background.g, background.b, background.a], i);
        for (const [row, content] of lines.entries()) {
            const gravity = layout?.gravity;
            const centered = gravity === "center" || gravity === "north" || gravity === "south";
            const right = gravity === "east" || gravity === "northeast" || gravity === "southeast";
            let x = centered ? (width - measure(content)) / 2 : right ? width - measure(content) - (layout?.wrap ? 1 : 0) : 0;
            let baseline = ascent;
            if (gravity === "center" || gravity === "west" || gravity === "east")
                baseline = (height + ascent + descent - (lines.length - 1) * lineHeight) / 2;
            else if (gravity === "south" || gravity === "southwest" || gravity === "southeast") baseline = height + descent - (lines.length - 1) * lineHeight;
            else if (layout?.wrap && (gravity === "north" || gravity === "northwest" || gravity === "northeast")) {
                baseline = 0;
                for (const char of content) baseline = Math.max(baseline, glyph(char).top);
            }
            let previous = 0;
            for (const char of content) {
                const { width: columns, height: rows, pitch, bitmap, left, top, advance, id } = glyph(char);
                x += runtime._font_kerning(previous, id) / 64;
                for (let y = 0; y < rows; y++) for (let column = 0; column < columns; column++) {
                    const dx = Math.floor(x) + left + column, dy = Math.floor(row * lineHeight + baseline) - top + y;
                    if (dx < 0 || dx >= width || dy < 0 || dy >= height) continue;
                    const alpha = runtime.HEAPU8[bitmap + y * pitch + column]! / 255 * fill.a / 255;
                    const at = (dy * width + dx) * 4, behind = pixels[at + 3]! / 255 * (1 - alpha), combined = alpha + behind;
                    for (const [channel, value] of [fill.r, fill.g, fill.b].entries()) pixels[at + channel] = combined ? Math.fround((value * alpha + pixels[at + channel]! * behind) / combined * 257) / 257 : 0;
                    pixels[at + 3] = Math.fround(combined * 65535) / 257;
                }
                x += advance; previous = id;
            }
        }
        return { width, height, pixels };
    } finally { runtime._font_close(); runtime._free(pointer); }
}
