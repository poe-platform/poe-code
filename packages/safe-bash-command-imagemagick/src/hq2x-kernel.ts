/*!
 * HQ2x rules adapted from ImageMagick 7.1.2-35 MagickCore/resize.c.
 * Copyright 1999 ImageMagick Studio LLC. Licensed under the ImageMagick
 * License (https://imagemagick.org/license/); see ../LICENSE for its text.
 * Modified for bounded TypeScript RGBA raster processing.
 */
const rules = [
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 15, 12, 5,  3, 17, 13,
    4, 4, 6, 18, 4, 4, 6, 18, 5,  3, 12, 12, 5,  3,  1, 12,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 17, 13, 5,  3, 16, 14,
    4, 4, 6, 18, 4, 4, 6, 18, 5,  3, 16, 12, 5,  3,  1, 14,
    4, 4, 6,  2, 4, 4, 6,  2, 5, 19, 12, 12, 5, 19, 16, 12,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 16, 12, 5,  3, 16, 12,
    4, 4, 6,  2, 4, 4, 6,  2, 5, 19,  1, 12, 5, 19,  1, 14,
    4, 4, 6,  2, 4, 4, 6, 18, 5,  3, 16, 12, 5, 19,  1, 14,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 15, 12, 5,  3, 17, 13,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 16, 12, 5,  3, 16, 12,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 17, 13, 5,  3, 16, 14,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 16, 13, 5,  3,  1, 14,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 16, 12, 5,  3, 16, 13,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 16, 12, 5,  3,  1, 12,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3, 16, 12, 5,  3,  1, 14,
    4, 4, 6,  2, 4, 4, 6,  2, 5,  3,  1, 12, 5,  3,  1, 14
];

// Center, diagonal, top, left weights for the unconditional mixing rules.
const weights = [
    [1, 0, 0, 0], [3, 1, 0, 0], [3, 0, 0, 1], [3, 0, 1, 0],
    [2, 0, 1, 1], [2, 1, 1, 0], [2, 1, 0, 1], [5, 0, 2, 1],
    [5, 0, 1, 2], [6, 0, 1, 1], [2, 0, 3, 3], [14, 0, 1, 1]
] as const;

// Neighbors in bit order, rotated for top-left, top-right, bottom-left, bottom-right.
const neighborhoods = [
    [0, 1, 2, 3, 5, 6, 7, 8],
    [2, 5, 8, 1, 7, 0, 3, 6],
    [6, 3, 0, 7, 1, 8, 5, 2],
    [8, 7, 6, 5, 3, 2, 1, 0]
] as const;

export function hq2xPixels(pixels: (Uint16Array | Float64Array)[], equal: (a: number, b: number) => boolean): Float64Array[] {
    const different = pixels.map((_, index) => !equal(4, index));
    return neighborhoods.map(neighbors => {
        let pattern = 0;
        for (let bit = 0; bit < neighbors.length; bit++) if (different[neighbors[bit]!]) pattern |= 1 << bit;
        const [a, b, , d, f, , h] = neighbors;
        let rule = rules[pattern]!;
        // Conditional rules choose a blend by comparing the rotated side pixels.
        if (rule >= 12 && rule <= 17) {
            rule = equal(b, d) ? [4, 10, 11, 4, 9, 10][rule - 12]! : rule <= 14 ? 0 : 1;
        } else if (rule === 18) rule = equal(b, f) ? 7 : 2;
        else if (rule === 19) rule = equal(d, h) ? 8 : 3;
        const [center, diagonal, top, left] = weights[rule]!;
        const divisor = center + diagonal + top + left;
        const output = new Float64Array(4);
        for (let channel = 0; channel < 4; channel++) {
            // Native MixPixels truncates the Q16 integer average, including alpha.
            output[channel] = Math.floor((center * pixels[4]![channel]! + diagonal * pixels[a]![channel]!
                + top * pixels[b]![channel]! + left * pixels[d]![channel]!) / divisor);
        }
        return output;
    });
}
