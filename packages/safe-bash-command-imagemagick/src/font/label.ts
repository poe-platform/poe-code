import createFontRuntime from "./runtime.js";

export function measureFontLabel(bytes: Uint8Array, text: string, width: number, height: number, pointsize: number, density: number, strokeWidth: number, signal?: AbortSignal) {
    if (bytes.length > 16 * 1024 * 1024) throw new Error("font exceeds memory limit");
    signal?.throwIfAborted();
    const runtime = createFontRuntime();
    const pointer = runtime._malloc(bytes.length);
    if (!pointer) throw new Error("font exceeds memory limit");
    try {
        runtime.HEAPU8.set(bytes, pointer);
        const lines = text.split("\n");
        const measure = (size: number) => {
            runtime._font_close();
            if (runtime._font_open(pointer, bytes.length, size, density, density)) throw new Error("unable to read font");
            const metric = runtime._font_metrics() / 4;
            const lineHeight = (runtime.HEAP32[metric]! - runtime.HEAP32[metric + 1]!) / 64;
            const underline = runtime.HEAP32[metric + 3]! / 64;
            let widest = 0, bearing = 0;
            for (const line of lines) {
                let advance = 0, previous = 0, left = 0, lastAdvance = 0, lastBound = 0;
                for (const char of line) {
                    signal?.throwIfAborted();
                    const address = runtime._font_glyph(char.codePointAt(0)!);
                    if (!address) throw new Error("unable to render font glyph");
                    const at = address / 4, values = runtime.HEAP32, id = values[at + 7]!;
                    lastAdvance = Math.round(values[at + 10]! / 1024) / 64;
                    lastBound = values[at + 9]! / 64;
                    left = Math.min(left, values[at + 8]! / 64);
                    advance += runtime._font_kerning(previous, id, 1) / 64 + lastAdvance;
                    previous = id;
                }
                const extent = Math.ceil(advance + Math.max(0, lastBound - lastAdvance));
                if (extent > widest) { widest = extent; bearing = left; }
            }
            return { width: widest + (bearing < 0 ? 2 * Math.ceil(-bearing + 0.5) : 0), height: lines.length * lineHeight, underline };
        };
        let metrics = measure(pointsize);
        // Native labels auto-fit when exactly one axis is given, even with -pointsize.
        if (text && (width === 0) !== (height === 0)) {
            let low = 1, high = pointsize;
            for (let attempt = 0; attempt < 32; attempt++, high *= 2) {
                metrics = measure(high);
                if (width && Math.floor(metrics.width + strokeWidth + 0.5) > width
                    || height && Math.floor(metrics.height - metrics.underline + strokeWidth + 0.5) > height) break;
            }
            while (high - low > 0.5) {
                pointsize = (low + high) / 2;
                metrics = measure(pointsize);
                if (width && Math.floor(metrics.width + strokeWidth + 0.5) < width
                    || height && Math.floor(metrics.height - metrics.underline + strokeWidth + 0.5) < height) low = pointsize + 0.5;
                else high = pointsize - 0.5;
            }
            pointsize = Math.floor(low - 0.5);
            metrics = measure(pointsize);
        }
        return {
            width: width || Math.max(1, Math.floor(metrics.width + strokeWidth + 0.5)),
            height: height || Math.max(1, Math.floor(metrics.height + strokeWidth + 0.5)),
            pointsize
        };
    } finally { runtime._font_close(); runtime._free(pointer); }
}
