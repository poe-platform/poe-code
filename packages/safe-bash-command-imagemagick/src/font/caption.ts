import type { GravityPosition, RgbaColor } from "@poe-code/image-ast/portable";
import createFontRuntime from "./runtime.js";

export function wrapFontCaption(bytes: Uint8Array, text: string, width: number, pointsize: number, density: number, strokeWidth: number, signal?: AbortSignal): string[] {
    if (bytes.length > 16 * 1024 * 1024) throw new Error("font exceeds memory limit");
    signal?.throwIfAborted();
    const runtime = createFontRuntime();
    const pointer = runtime._malloc(bytes.length);
    if (!pointer) throw new Error("font exceeds memory limit");
    try {
        runtime.HEAPU8.set(bytes, pointer);
        if (runtime._font_open(pointer, bytes.length, pointsize, density, density)) throw new Error("unable to read font");
        // Native caption wrapping measures the current prefix, including stroke width.
        const lines: string[] = [];
        let line = "", advance = 0, previous = 0, lastSpace = -1;
        for (const char of text) {
            if (char === "\n") { lines.push(line); line = ""; advance = previous = 0; lastSpace = -1; continue; }
            signal?.throwIfAborted();
            const address = runtime._font_glyph(char.codePointAt(0)!);
            if (!address) throw new Error("unable to render font glyph");
            const at = address / 4, id = runtime.HEAP32[at + 7]!;
            const advanceWidth = runtime.HEAP32[at + 6]! / 64;
            advance += runtime._font_kerning(previous, id) / 64 + advanceWidth;
            if (char === " " || char === "\t") lastSpace = line.length;
            if (Math.floor(advance + strokeWidth + 0.5) > width) {
                if (lastSpace >= 0) {
                    lines.push(line.slice(0, lastSpace));
                    line = line.slice(lastSpace + 1) + char;
                } else if (line) { lines.push(line); line = char; }
                else line = char;
                advance = previous = 0; lastSpace = -1;
            } else { line += char; previous = id; }
        }
        lines.push(line);
        return lines;
    } finally { runtime._font_close(); runtime._free(pointer); }
}

export function renderFontCaption(bytes: Uint8Array, text: string, width: number, pointsize: number, density: number, fill: RgbaColor, background: RgbaColor, strokeWidth: number, signal?: AbortSignal, layout?: { height?: number; wrap: boolean; gravity: GravityPosition }) {
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
        const measure = (text: string) => {
            let width = 0, previous = 0;
            for (const char of text) {
                const values = glyph(char);
                width += runtime._font_kerning(previous, values.id) / 64 + values.advance;
                previous = values.id;
            }
            return width;
        };
        if (!width) width = Math.max(1, Math.ceil(Math.max(...text.split("\n").map(measure)) + strokeWidth));
        const lines = layout?.wrap === false ? text.split("\n") : wrapFontCaption(bytes, text, width, pointsize, density, strokeWidth, signal);
        const textHeight = Math.floor(lines.length * lineHeight + 0.5);
        const height = layout?.height ?? textHeight;
        if (!Number.isSafeInteger(width * height) || width * height > 2 ** 20) throw new Error("font caption exceeds pixel limit");
        const pixels = new Float64Array(width * height * 4);
        for (let i = 0; i < pixels.length; i += 4) pixels.set([background.r, background.g, background.b, background.a], i);
        for (const [row, content] of lines.entries()) {
            const gravity = layout?.gravity ?? "undefined";
            const centered = (gravity === "center" || gravity === "north" || gravity === "south");
            const east = (gravity === "northeast" || gravity === "east" || gravity === "southeast");
            let x = centered ? (width - measure(content)) / 2 : east ? width - measure(content) : 0, previous = 0;
            const yOffset = (gravity === "center" || gravity === "east" || gravity === "west") ? (height - textHeight) / 2
                : (gravity === "south" || gravity === "southeast" || gravity === "southwest") ? height - textHeight : 0;
            for (const char of content) {
                const { width: columns, height: rows, pitch, bitmap, left, top, advance, id } = glyph(char);
                x += runtime._font_kerning(previous, id) / 64;
                for (let y = 0; y < rows; y++) for (let column = 0; column < columns; column++) {
                    const dx = Math.floor(x) + left + column, dy = Math.floor(yOffset + row * lineHeight + ascent) - top + y;
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
