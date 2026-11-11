import type { ImageMetadata } from "../ast.js";

export interface FloatmapHeader {
    metadata: ImageMetadata;
    offset: number;
    little: boolean;
    scale: number;
}

export function* floatmapSequenceSteps(size: number, header: (size: number) => Generator<number, FloatmapHeader, number | undefined>, page?: number): Generator<number, FloatmapHeader, number | undefined> {
    let offset = 0, pages = 0;
    let first: FloatmapHeader | undefined;
    while (offset < size) {
        const steps = header(size - offset);
        let next = steps.next();
        while (!next.done) next = steps.next(yield offset + next.value);
        const frame = { ...next.value, offset: offset + next.value.offset, metadata: { ...next.value.metadata, size } };
        first ??= frame;
        if (pages++ === page) return frame;
        const { width, height, channels, bitsPerSample } = frame.metadata;
        // Skip the exact raster length; sample bytes may contain header-like text.
        offset = frame.offset + width * height * channels * (bitsPerSample! / 8);
        if (offset < size && (yield offset) !== 80) break;
    }
    if (!first || page !== undefined) throw new RangeError("Floatmap page out of range");
    return { ...first, metadata: { ...first.metadata, ...(pages > 1 ? { pages } : {}) } };
}
