/** TIFF CIELab samples to sRGB, matching ImageMagick's signed sample scaling. */
export function tiffLabToRgb(l: number, a: number, b: number, max: number): [number, number, number] {
    const signed = (value: number) => (value > max / 2 ? value - max : value) * 255 / max;
    const fy = (100 * l / max + 16) / 116;
    const inverse = (value: number) => value ** 3 > 216 / 24389 ? value ** 3 : (116 * value - 16) / (24389 / 27);
    const x = 0.95047 * inverse(fy + signed(a) / 500);
    const y = inverse(fy);
    const z = 1.08883 * inverse(fy - signed(b) / 200);
    const r = 3.240969941904521 * x - 1.537383177570093 * y - 0.498610760293 * z;
    const g = -0.96924363628087 * x + 1.87596750150772 * y + 0.041555057407175 * z;
    const blue = 0.055630079696993 * x - 0.20397695888897 * y + 1.056971514242878 * z;
    const minimum = Math.min(0, r, g, blue);
    const encode = (value: number) => {
        const linear = value - minimum;
        return Math.min(max, Math.max(0, Math.round(max * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055))));
    };
    return [encode(r), encode(g), encode(blue)];
}
