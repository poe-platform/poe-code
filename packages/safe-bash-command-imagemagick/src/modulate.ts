// ImageMagick modulation operates on gamma-encoded RGB, except CIE LCh.
export function modulateRgb(r: number, g: number, b: number, brightness: number, saturation: number, shift: number, space: string): [number, number, number] {
    if (space === "lchab" || space === "lch" || space === "lchuv") {
        const linear = [r, g, b].map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        let x = 0.412395588967414 * linear[0]! + 0.357583430763715 * linear[1]! + 0.180492647381701 * linear[2]!;
        let y = 0.212586230785596 * linear[0]! + 0.715170303703411 * linear[1]! + 0.0722004986433362 * linear[2]!;
        let z = 0.0192972154917469 * linear[0]! + 0.119183864580849 * linear[1]! + 0.95049712513158 * linear[2]!;
        const epsilon = 216 / 24389, k = 24389 / 27;
        const f = (v: number) => v > epsilon ? Math.cbrt(v) : (k * v + 16) / 116;
        let l = 116 * f(y) - 16;
        const un = 4 * 0.95047 / (0.95047 + 15 + 3 * 1.08883), vn = 9 / (0.95047 + 15 + 3 * 1.08883);
        const divisor = x + 15 * y + 3 * z;
        let a = space === "lchuv" ? 13 * l * ((divisor ? 4 * x / divisor : 0) - un) : 500 * (f(x / 0.95047) - f(y));
        let c = space === "lchuv" ? 13 * l * ((divisor ? 9 * y / divisor : 0) - vn) : 200 * (f(y) - f(z / 1.08883));
        const angle = Math.atan2(c, a) + shift * Math.PI / 3;
        // Native LCh chroma has a 0.5 offset before percentage scaling.
        const chroma = (Math.hypot(a, c) + 127.5) * saturation - 127.5;
        a = chroma * Math.cos(angle); c = chroma * Math.sin(angle); l *= brightness;
        const inverse = (v: number) => v ** 3 > epsilon ? v ** 3 : (116 * v - 16) / k;
        y = l > k * epsilon ? ((l + 16) / 116) ** 3 : l / k;
        if (space === "lchuv") {
            const u = l ? a / (13 * l) + un : un, v = l ? c / (13 * l) + vn : vn;
            x = v ? 9 * y * u / (4 * v) : 0;
            z = v ? y * (12 - 3 * u - 20 * v) / (4 * v) : 0;
        } else {
            x = 0.95047 * inverse((l + 16) / 116 + a / 500);
            z = 1.08883 * inverse((l + 16) / 116 - c / 200);
        }
        const rgb = [3.240969941904521 * x - 1.537383177570093 * y - 0.498610760293 * z,
            -0.96924363628087 * x + 1.87596750150772 * y + 0.041555057407175 * z,
            0.055630079696993 * x - 0.20397695888897 * y + 1.056971514242878 * z];
        const min = Math.min(0, ...rgb);
        return rgb.map(v => { v -= min; return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; }) as [number, number, number];
    }
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
    if (space === "hsi") {
        const intensity = (r + g + b) / 3;
        hue = Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 3 / Math.PI;
        hue = ((hue + shift) % 6 + 6) % 6;
        const sat = intensity ? (1 - min / intensity) * saturation : 0, light = intensity * brightness;
        const low = light * (1 - sat), high = light * (1 + sat * Math.cos((hue % 2) * Math.PI / 3) / Math.cos((1 - hue % 2) * Math.PI / 3));
        const mid = 3 * light - low - high;
        return hue < 2 ? [high, mid, low] : hue < 4 ? [low, high, mid] : [mid, low, high];
    }
    if (space === "hwb") {
        hue = (delta === 0 ? -6 : hue === 0 ? 6 : hue) + shift;
        const sector = Math.floor(hue), fraction = sector % 2 ? 1 - (hue - sector) : hue - sector;
        const white = min * saturation, value = 1 - (1 - max) * brightness;
        if (hue === -6) return [value, value, value];
        const middle = white + fraction * (value - white);
        return sector === 1 ? [middle, value, white] : sector === 2 ? [white, value, middle] : sector === 3 ? [white, middle, value] : sector === 4 ? [middle, white, value] : sector === 5 ? [value, white, middle] : [value, middle, white];
    }
    const hcl = space === "hcl" || space === "hclp", hsb = space === "hsb" || space === "hsv";
    hue += shift;
    if (!hcl) hue = (hue % 6 + 6) % 6;
    const lightness = hsb ? max : (max + min) / 2;
    const sat = delta === 0 ? 0 : delta / (hsb ? max : lightness <= 0.5 ? max + min : 2 - max - min);
    const light = lightness * brightness;
    const chroma = hcl ? delta * saturation : (hsb ? light : 1 - Math.abs(2 * light - 1)) * sat * saturation;
    const secondary = chroma * (1 - Math.abs(hue % 2 - 1));
    const rgb: [number, number, number] = hue < 0 || hue >= 6 ? [0, 0, 0] : hue < 1 ? [chroma, secondary, 0] : hue < 2 ? [secondary, chroma, 0] : hue < 3 ? [0, chroma, secondary] : hue < 4 ? [0, secondary, chroma] : hue < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
    const luma = (0.298839 * r + 0.586811 * g + 0.114350 * b) * brightness;
    let offset = hcl ? luma - (0.298839 * rgb[0] + 0.586811 * rgb[1] + 0.114350 * rgb[2]) : light - chroma / (hsb ? 1 : 2), scale = 1;
    if (space === "hclp") {
        if (offset < 0) { scale = luma / (luma - offset); offset = 0; }
        else if (offset + chroma > 1) { scale = (1 - luma) / (offset + chroma - luma); offset = 1 - scale * chroma; }
    }
    return [rgb[0] * scale + offset, rgb[1] * scale + offset, rgb[2] * scale + offset];
}
