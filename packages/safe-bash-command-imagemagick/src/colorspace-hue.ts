import type { RgbaImage } from "@poe-code/image-ast/portable";
import { convertProPhoto } from "./colorspace-prophoto.js";
import { formatMetricNum } from "./compare-kernel.js";

// Native YCCMap is a float ramp rounded to six decimals, then stored as float.
const yccMap = Float32Array.from({ length: 1389 }, (_, index) => Math.round(Math.fround(index / 1388) * 1e6) / 1e6);

export interface HueMetadata {
    magickColorspace?: "HCL" | "HCLp" | "HSI" | "HSL" | "HSB" | "HSV" | "HWB" | "DisplayP3" | "XYZ" | "CAT02LMS" | "LMS" | "xyY" | "ProPhoto" | "Jzazbz" | "CIELab" | "YPbPr" | "YCbCr" | "Rec601YCbCr" | "YCC" | "Rec709YCbCr" | "Log" | "Adobe98" | "OHTA" | "CMY" | "YUV" | "YIQ" | "YDbDr" | "Luv" | "LCH" | "LCHab" | "LCHuv" | "Oklab" | "Oklch" | "RGB" | "Gray";
    // Preserve native HDRI precision for expressions; codecs use the integer planes.
    hueSamples?: Float64Array;
    storedHueSamples?: number;
}

export function* convertHuePixels(image: RgbaImage & HueMetadata, target: "HCL" | "HCLp" | "HSI" | "HSL" | "HSB" | "HSV" | "HWB" | "DisplayP3" | "XYZ" | "CAT02LMS" | "LMS" | "xyY" | "ProPhoto" | "Jzazbz" | "CIELab" | "YPbPr" | "YCbCr" | "Rec601YCbCr" | "YCC" | "Rec709YCbCr" | "Log" | "Adobe98" | "OHTA" | "CMY" | "YUV" | "YIQ" | "YDbDr" | "Luv" | "LCH" | "LCHab" | "LCHuv" | "Oklch" | "Oklab" | "sRGB"): Generator<void, RgbaImage & HueMetadata, void> {
    if (image.magickColorspace === target) return image;
    if (target === "CIELab" || target === "XYZ" || target === "HSL") image = { ...image, isPalette: false };
    const rec601 = target === "Rec601YCbCr" || image.magickColorspace === "Rec601YCbCr";
    const ohta = target === "OHTA" || image.magickColorspace === "OHTA";
    const toHue = target !== "sRGB", hsb = toHue ? target === "HSB" || target === "HSV" : image.magickColorspace === "HSB" || image.magickColorspace === "HSV";
    const hwb = toHue ? target === "HWB" : image.magickColorspace === "HWB";
    const lch = target === "LCH" || target === "LCHab" || target === "LCHuv";
    const sourceLch = image.magickColorspace === "LCH" || image.magickColorspace === "LCHab" || image.magickColorspace === "LCHuv";
    const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
    // Lab, LCH, Oklab, Oklch, Luv, xyY, YUV, YCbCr and OHTA need HDRI samples before integer rounding or clamping.
    const inputEvaluateSamples = target === "ProPhoto" || target === "DisplayP3" || target === "CAT02LMS" || target === "LMS" || target === "Adobe98" || target === "HSI" || target === "Jzazbz" || target === "CMY" || lch || target === "Log" || target === "xyY" || target === "Oklch" || target === "Oklab" || target === "Luv" || target === "OHTA" || target === "CIELab" || target === "YUV" || target === "YIQ" || target === "YDbDr" || target === "Rec601YCbCr" || ((target === "YPbPr" || target === "YCbCr") || target === "YCC" || target === "Rec709YCbCr") ? image.evaluateSamples : undefined;
    const input = image.hueSamples ?? inputEvaluateSamples ?? image.data16 ?? image.data, range = image.hueSamples ? 1 : inputEvaluateSamples ? 255 : image.data16 ? 65535 : 255;
    const hueSamples = toHue ? new Float64Array(data.length) : undefined;
    const evaluateSamples = toHue ? undefined : new Float64Array(data.length);
    for (let offset = 0; offset < data.length; offset += 4) {
        if (offset % 65536 === 0) yield;
        let r = input[offset]! / range, g = input[offset + 1]! / range, b = input[offset + 2]! / range;
        // Rec601 and OHTA use Q16 lookup indices in both directions, including float
        // quantum rounding before the lookup; generic YCbCr uses direct arithmetic.
        if (rec601 || ohta) [r, g, b] = [r, g, b].map(value => Math.floor(Math.fround(Math.fround(Math.max(0, Math.min(1, value)) * 65535) + 0.5)) / 65535) as [number, number, number];
        if (target === "ProPhoto" || image.magickColorspace === "ProPhoto") {
            [r, g, b] = convertProPhoto(r, g, b, target === "sRGB");
        } else if (target === "CMY" || image.magickColorspace === "CMY") {
            r = 1 - r; g = 1 - g; b = 1 - b;
        } else if (target === "Log" || image.magickColorspace === "Log") {
            // Native's default Cineon curve uses Q16 lookup indices and float
            // quantum samples, including the linear-light intermediate values.
            const black = 10 ** ((95 - 685) * 0.002 / 0.6);
            [r, g, b] = [r, g, b].map(value => {
                if (target === "Log") {
                    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                    const index = Math.round(Math.max(0, Math.min(65535, Math.fround(linear * 65535))));
                    return Math.fround(65535 * (685 + Math.log10(black + index / 65535 * (1 - black)) / (0.002 / 0.6)) / 1024) / 65535;
                }
                const index = Math.round(Math.max(0, Math.min(1, value)) * 65535);
                const linear = index <= Math.floor(95 * 65535 / 1024) ? 0 : index >= Math.floor(685 * 65535 / 1024) ? 1
                    : Math.fround(65535 * (10 ** ((1024 * index / 65535 - 685) * 0.002 / 0.6) - black) / (1 - black)) / 65535;
                return Math.fround(65535 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055)) / 65535;
            }) as [number, number, number];
        } else if (target === "Oklab" || target === "Oklch") {
            const [red, green, blue] = [r, g, b].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) as [number, number, number];
            const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
            const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
            const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
            const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
            const bValue = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
            r = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
            if (target === "Oklch") {
                // Native Oklch hue is in radians and can exceed one.
                const hue = Math.atan2(bValue, a);
                g = Math.sqrt(a * a + bValue * bValue);
                b = hue < 0 ? hue + 2 * Math.PI : hue;
            } else {
                // ImageMagick stores signed Oklab chroma with a half-range offset.
                g = a + 0.5; b = bValue + 0.5;
            }
        } else if (image.magickColorspace === "Oklab" || image.magickColorspace === "Oklch") {
            // Native Oklab offsets a/b by 0.5; Oklch stores hue in radians.
            const a = image.magickColorspace === "Oklch" ? g * Math.cos(b) : g - 0.5;
            const chromaB = image.magickColorspace === "Oklch" ? g * Math.sin(b) : b - 0.5;
            const l = (r + 0.3963377774 * a + 0.2158037573 * chromaB) ** 3;
            const m = (r - 0.1055613458 * a - 0.0638541728 * chromaB) ** 3;
            const s = (r - 0.0894841775 * a - 1.2914855480 * chromaB) ** 3;
            [r, g, b] = [
                4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
            ].map(value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055) as [number, number, number];
        } else if (ohta) {
            // Native OHTA uses Q16 lookup tables in both directions. Its forward
            // chroma offset is 32768, while the inverse subtracts 32767.5.
            [r, g, b] = target === "OHTA"
                ? [0.33333 * r + 0.33334 * g + 0.33333 * b,
                    32768 / 65535 + 0.5 * r - 0.5 * b,
                    32768 / 65535 - 0.25 * r + 0.5 * g - 0.25 * b]
                : [r + (g - 0.5) - 0.66668 * (b - 0.5),
                    r + 1.33333 * (b - 0.5),
                    r - (g - 0.5) - 0.66668 * (b - 0.5)];
        } else if (target === "YCC" || image.magickColorspace === "YCC") {
            // Photo YCC indexes Q16 tables, with chroma zero at 156 and 137.
            const [red, green, blue] = [r, g, b].map(value => Math.floor(Math.fround(Math.max(0, Math.min(65535, Math.fround(value * 65535))) + 0.5))) as [number, number, number];
            if (target === "YCC") {
                const high = (value: number) => 1.099 * value - 0.099;
                [r, g, b] = [
                    (red <= 1179 ? 0.005382 * red : 0.298839 * high(red)) + (green <= 1179 ? 0.010566 * green : 0.586811 * high(green)) + (blue <= 1179 ? 0.002052 * blue : 0.114350 * high(blue)),
                    156 * 257 + (red <= 1179 ? -0.003296 * red : -0.298839 * high(red)) + (green <= 1179 ? -0.006471 * green : -0.586811 * high(green)) + (blue <= 1179 ? 0.009768 * blue : 0.88600 * high(blue)),
                    137 * 257 + (red <= 1179 ? 0.009410 * red : 0.70100 * high(red)) + (green <= 1179 ? -0.007880 * green : -0.586811 * high(green)) + (blue <= 1179 ? -0.001530 * blue : -0.114350 * high(blue)),
                ].map(value => Math.fround(Math.max(0, Math.min(65535, value))) / 65535) as [number, number, number];
            } else {
                [r, g, b] = [
                    1.3584 * red + 1.8215 * (blue - 137 * 257),
                    1.3584 * red - 0.4302726 * (green - 156 * 257) - 0.9271435 * (blue - 137 * 257),
                    1.3584 * red + 2.2179 * (green - 156 * 257),
                ].map(value => Math.fround(yccMap[Math.round(Math.max(0, Math.min(1388, 1024 * value / 65535)))]! * 65535) / 65535) as [number, number, number];
            }
        } else if (target === "YDbDr") {
            [r, g, b] = [0.298839 * r + 0.586811 * g + 0.11435 * b,
                0.5 - 0.450 * r - 0.883 * g + 1.333 * b,
                0.5 - 1.333 * r + 1.116 * g + 0.217 * b];
        } else if (image.magickColorspace === "YDbDr") {
            [r, g, b] = [r + 9.2303716147657e-05 * (g - 0.5) - 0.52591263066186533 * (b - 0.5),
                r - 0.12913289889050927 * (g - 0.5) + 0.26789932820759876 * (b - 0.5),
                r + 0.66467905997895482 * (g - 0.5) - 7.9202543533108e-05 * (b - 0.5)];
        } else if (target === "YIQ") {
            [r, g, b] = [0.298839 * r + 0.586811 * g + 0.11435 * b,
                0.5 + 0.595716 * r - 0.274453 * g - 0.321263 * b,
                0.5 + 0.211456 * r - 0.522591 * g + 0.311135 * b];
        } else if (image.magickColorspace === "YIQ") {
            [r, g, b] = [r + 0.9562957197589482261 * (g - 0.5) + 0.6210244164652610754 * (b - 0.5),
                r - 0.2721220993185104464 * (g - 0.5) - 0.6473805968256950427 * (b - 0.5),
                r - 1.1069890167364901945 * (g - 0.5) + 1.7046149983646481374 * (b - 0.5)];
        } else if (target === "YUV") {
            [r, g, b] = [0.298839 * r + 0.586811 * g + 0.11435 * b,
                0.5 - 0.147 * r - 0.289 * g + 0.436 * b,
                0.5 + 0.615 * r - 0.515 * g - 0.1 * b];
        } else if (image.magickColorspace === "YUV") {
            // ImageMagick's inverse includes cross-channel terms even near zero.
            [r, g, b] = [r - 3.945707070708279e-05 * (g - 0.5) + 1.1398279671717170825 * (b - 0.5),
                r - 0.3946101641414141437 * (g - 0.5) - 0.5805003156565656797 * (b - 0.5),
                r + 2.0319996843434342537 * (g - 0.5) - 4.813762626262513e-04 * (b - 0.5)];
        } else if (target === "Rec709YCbCr" || image.magickColorspace === "Rec709YCbCr") {
            // Native Rec709 uses Q16 lookup indices in both directions, with a
            // 32768 forward chroma offset and a 32767.5 inverse midpoint.
            [r, g, b] = [r, g, b].map(value => Math.round(Math.max(0, Math.min(1, value)) * 65535) / 65535) as [number, number, number];
            [r, g, b] = target === "Rec709YCbCr"
                ? [0.212656 * r + 0.715158 * g + 0.072186 * b,
                    32768 / 65535 - 0.114572 * r - 0.385428 * g + 0.5 * b,
                    32768 / 65535 + 0.5 * r - 0.454153 * g - 0.045847 * b]
                : [r + 1.5748 * (b - 0.5),
                    r - 0.187324 * (g - 0.5) - 0.468124 * (b - 0.5),
                    r + 1.8556 * (g - 0.5)];
            [r, g, b] = [r, g, b].map(value => Math.max(0, Math.min(1, value))) as [number, number, number];
        } else if ((target === "YPbPr" || target === "YCbCr") || target === "Rec601YCbCr") {
            const offset = rec601 ? 32768 / 65535 : 0.5;
            [r, g, b] = [0.298839 * r + 0.586811 * g + 0.11435 * b,
                offset - 0.1687367 * r - 0.331264 * g + 0.5 * b,
                offset + 0.5 * r - 0.418688 * g - 0.081312 * b];
        } else if ((image.magickColorspace === "YPbPr" || image.magickColorspace === "YCbCr") || image.magickColorspace === "Rec601YCbCr") {
            // ImageMagick's inverse YPbPr matrix preserves Q16 rounding boundaries.
            [r, g, b] = [0.9999999999991468 * r - 1.2188941887145875e-6 * (g - 0.5) + 1.401999588656144 * (b - 0.5),
                0.9999997591050251 * r - 0.34413567816504304 * (g - 0.5) - 0.7141364933164679 * (b - 0.5),
                1.0000012404000462 * r + 1.772000066072304 * (g - 0.5) + 2.1453384174593273e-6 * (b - 0.5)];
        } else if (target === "Jzazbz" || target === "Adobe98" || target === "LMS" || target === "CAT02LMS" || target === "DisplayP3" || target === "XYZ" || target === "xyY" || target === "CIELab" || target === "Luv" || lch) {
            // Native Jzazbz swaps green and blue in both RGB conversion directions.
            if (target === "Jzazbz") [g, b] = [b, g];
            // Native CAT02LMS converts RGB through LMS back to XYZ before storing channels.
            const linear = [r, g, b].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
            [r, g, b] = [
                0.412395588967414 * linear[0]! + 0.357583430763715 * linear[1]! + 0.180492647381701 * linear[2]!,
                0.212586230785596 * linear[0]! + 0.715170303703411 * linear[1]! + 0.0722004986433362 * linear[2]!,
                0.0192972154917469 * linear[0]! + 0.119183864580849 * linear[1]! + 0.95049712513158 * linear[2]!,
            ];
            if (target === "Jzazbz") {
                const x = b + 1.15 * (r - b), y = r + 0.66 * (g - r);
                const [l, m, s] = [
                    0.0146480 * b + 0.41478972 * x + 0.579999 * y,
                    0.0531008 * b - 0.2015100 * x + 1.120649 * y,
                    0.6684799 * b - 0.0166008 * x + 0.264800 * y,
                ].map(value => {
                    const power = (value / 10000) ** (2610 / 16384);
                    return ((3424 / 4096 + 2413 / 128 * power) / (1 + 2392 / 128 * power)) ** (1.7 * 2523 / 32);
                }) as [number, number, number];
                const intensity = (l + m) / 2;
                r = (intensity - 0.56 * intensity) / (1 - 0.56 * intensity) - 1.6295499532821565e-11;
                g = 0.5 + 3.52400 * l - 4.066708 * m + 0.542708 * s;
                b = 0.5 + 0.199076 * l + 1.096799 * m - 1.295875 * s;
                [r, g, b] = [r, g, b].map((value, channel) => Number.isNaN(value) ? channel === 0 ? 0 : 0.5 : value) as [number, number, number];
            } else if (target === "Adobe98") {
                // ImageMagick uses its sRGB transfer curve with Adobe98 primaries.
                [r, g, b] = [
                    2.0415879038107465 * r - 0.5650069742788596 * g - 0.34473135077832956 * b,
                    -0.9692436362808795 * r + 1.8759675015077202 * g + 0.04155505740717557 * b,
                    0.013444280632031142 * r - 0.11836239223101838 * g + 1.0151749943912054 * b,
                ].map(value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055) as [number, number, number];
            } else if (target === "LMS") {
                [r, g, b] = [0.7328 * r + 0.4296 * g - 0.1624 * b,
                    -0.7036 * r + 1.6975 * g + 0.0061 * b,
                    0.0030 * r + 0.0136 * g + 0.9834 * b];
            } else if (target === "DisplayP3") {
                [r, g, b] = [
                    2.493496911941425 * r - 0.9313836179191239 * g - 0.40271078445071684 * b,
                    -0.8294889695615747 * r + 1.7626640603183463 * g + 0.023624685841943577 * b,
                    0.03584583024378447 * r - 0.07617238926804182 * g + 0.9568845240076872 * b,
                ].map(value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055) as [number, number, number];
            } else if (target === "xyY") {
                const sum = r + g + b;
                const reciprocal = 1 / (Math.abs(sum) >= 1e-12 ? sum : sum < 0 ? -1e-12 : 1e-12);
                [r, g, b] = [reciprocal * r, reciprocal * g, g];
            } else if (target === "CIELab" || target === "LCH" || target === "LCHab") {
                const f = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
                const x = f(r / 0.95047), y = f(g), z = f(b / 1.08883);
                [r, g, b] = [(116 * y - 16) / 100, 500 * (x - y) / 255 + 0.5, 200 * (y - z) / 255 + 0.5];
            } else if (target === "Luv" || target === "LCHuv") {
                const lightness = g > 216 / 24389 ? 116 * Math.cbrt(g) - 16 : 24389 / 27 * g;
                const denominator = r + 15 * g + 3 * b;
                const u = denominator === 0 ? 0 : 4 * r / denominator;
                const v = denominator === 0 ? 0 : 9 * g / denominator;
                const white = 0.95047 + 15 + 3 * 1.08883;
                [r, g, b] = [lightness / 100, (13 * lightness * (u - 4 * 0.95047 / white) + 134) / 354,
                    (13 * lightness * (v - 9 / white) + 140) / 262];
            }
            if (lch) {
                const a = target === "LCHuv" ? (g * 354 - 134) / 255 : g - 0.5;
                const chromaB = target === "LCHuv" ? (b * 262 - 140) / 255 : b - 0.5;
                const hue = Math.atan2(chromaB, a) / (2 * Math.PI);
                g = Math.hypot(a, chromaB) + 0.5;
                b = hue < 0 ? hue + 1 : hue;
            }
        } else if (image.magickColorspace === "Jzazbz" || image.magickColorspace === "Adobe98" || image.magickColorspace === "LMS" || image.magickColorspace === "CAT02LMS" || image.magickColorspace === "DisplayP3" || image.magickColorspace === "XYZ" || image.magickColorspace === "xyY" || image.magickColorspace === "CIELab" || image.magickColorspace === "Luv" || sourceLch) {
            if (sourceLch) {
                const chroma = (g - 0.5) * 255, hue = b * 2 * Math.PI;
                const a = chroma * Math.cos(hue), chromaB = chroma * Math.sin(hue);
                [g, b] = image.magickColorspace === "LCHuv"
                    ? [(a + 134) / 354, (chromaB + 140) / 262]
                    : [a / 255 + 0.5, chromaB / 255 + 0.5];
            }
            if (image.magickColorspace === "Jzazbz") {
                const j = r + 1.6295499532821565e-11, a = g - 0.5, chromaB = b - 0.5;
                const intensity = j / (1 - 0.56 * (1 - j));
                const c = 0.138605043271539 * a + 0.0580473161561189 * chromaB;
                const [l, m, s] = [intensity + c, intensity - c, intensity - 0.0960192420263189 * a - 0.811891896056039 * chromaB].map(value => {
                    const power = value ** (32 / (1.7 * 2523));
                    return 10000 * ((power - 3424 / 4096) / (2413 / 128 - 2392 / 128 * power)) ** (16384 / 2610);
                }) as [number, number, number];
                b = -0.0909828109828476 * l - 0.312728290523074 * m + 1.52276656130526 * s;
                if (Number.isNaN(b)) b = 0;
                r = b + (1.92422643578761 * l - 1.00479231259537 * m + 0.037651404030618 * s - b) / 1.15;
                if (Number.isNaN(r)) r = 0;
                g = r + (0.350316762094999 * l + 0.726481193931655 * m - 0.065384422948085 * s - r) / 0.66;
                if (Number.isNaN(g)) g = 0;
            } else if (image.magickColorspace === "Adobe98") {
                // Native CAT02LMS converts RGB through LMS back to XYZ before storing channels.
            const linear = [r, g, b].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
                [r, g, b] = [
                    0.5766690429101305 * linear[0]! + 0.1855582379065463 * linear[1]! + 0.1882286462349947 * linear[2]!,
                    0.29734497525053605 * linear[0]! + 0.6273635662554661 * linear[1]! + 0.07529145849399788 * linear[2]!,
                    0.02703136138641234 * linear[0]! + 0.07068885253582723 * linear[1]! + 0.9913375368376388 * linear[2]!,
                ];
            } else if (image.magickColorspace === "LMS") {
                [r, g, b] = [1.096123820835514 * r - 0.278869000218287 * g + 0.182745179382773 * b,
                    0.454369041975359 * r + 0.473533154307412 * g + 0.072097803717229 * b,
                    -0.009627608738429 * r - 0.005698031216113 * g + 1.015325639954543 * b];
            } else if (image.magickColorspace === "DisplayP3") {
                const linear = [r, g, b].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
                [r, g, b] = [
                    0.4865709486482162 * linear[0]! + 0.26566769316909306 * linear[1]! + 0.1982172852343625 * linear[2]!,
                    0.2289745640697488 * linear[0]! + 0.6917385218365064 * linear[1]! + 0.079286914093745 * linear[2]!,
                    0.04511338185890264 * linear[1]! + 1.043944368900976 * linear[2]!,
                ];
            } else if (image.magickColorspace === "xyY") {
                const reciprocal = 1 / (Math.abs(g) >= 1e-12 ? g : g < 0 ? -1e-12 : 1e-12);
                [r, g, b] = [reciprocal * b * r, b, reciprocal * b * (1 - r - g)];
            } else if (image.magickColorspace === "CIELab" || image.magickColorspace === "LCH" || image.magickColorspace === "LCHab") {
                const y = (r * 100 + 16) / 116, x = (g - 0.5) * 255 / 500 + y, z = y - (b - 0.5) * 255 / 200;
                const inverse = (value: number) => value > 6 / 29 ? value ** 3 : (value - 16 / 116) * 108 / 841;
                [r, g, b] = [0.95047 * inverse(x), inverse(y), 1.08883 * inverse(z)];
            } else if (image.magickColorspace === "Luv" || image.magickColorspace === "LCHuv") {
                const lightness = r * 100, white = 0.95047 + 15 + 3 * 1.08883;
                const u = lightness === 0 ? 0 : (g * 354 - 134) / (13 * lightness) + 4 * 0.95047 / white;
                const v = lightness === 0 ? 0 : (b * 262 - 140) / (13 * lightness) + 9 / white;
                const y = lightness > 8 ? ((lightness + 16) / 116) ** 3 : lightness * 27 / 24389;
                [r, g, b] = v === 0 ? [0, y, 0] : [9 * y * u / (4 * v), y, y * (12 - 3 * u - 20 * v) / (4 * v)];
            }
            const linear = [
                3.24096994190452 * r - 1.53738317757009 * g - 0.498610760293003 * b,
                -0.96924363628088 * r + 1.87596750150772 * g + 0.0415550574071756 * b,
                0.0556300796969937 * r - 0.203976958888977 * g + 1.05697151424288 * b,
            ];
            // ImageMagick shifts out-of-gamut linear channels together before encoding.
            const minimum = Math.min(0, ...linear);
            [r, g, b] = linear.map(sample => {
                const value = sample - minimum;
                return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
            }) as [number, number, number];
            if (image.magickColorspace === "Jzazbz") [g, b] = [b, g];
        } else if (target === "HSI") {
            const intensity = (r + g + b) / 3;
            const hue = Math.atan2(0.8660254037844385 * (g - b), 0.5 * (2 * r - g - b)) / (2 * Math.PI);
            [r, g, b] = intensity <= 0 ? [0, 0, intensity]
                : [hue < 0 ? hue + 1 : hue, 1 - Math.min(r, g, b) / intensity, intensity];
        } else if (image.magickColorspace === "HSI") {
            const hue = (r - Math.floor(r)) * 360, saturation = g, intensity = b;
            const angle = (hue % 120) * Math.PI / 180;
            const low = intensity * (1 - saturation);
            const high = intensity * (1 + saturation * Math.cos(angle) / Math.cos(Math.PI / 3 - angle));
            const middle = 3 * intensity - high - low;
            [r, g, b] = hue < 120 ? [high, middle, low] : hue < 240 ? [low, high, middle] : [middle, low, high];
        } else if (!toHue && (image.magickColorspace === "HCL" || image.magickColorspace === "HCLp")) {
            const hue = r * 6, chroma = g, luma = b, x = chroma * (1 - Math.abs(hue % 2 - 1));
            [r, g, b] = hue < 0 || hue >= 6 ? [0, 0, 0] : hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
            let m = luma - (0.298839 * r + 0.586811 * g + 0.114350 * b), scale = 1;
            if (image.magickColorspace === "HCLp") {
                if (m < 0) { scale = luma / (luma - m); m = 0; }
                else if (m + chroma > 1) { scale = (1 - luma) / (m + chroma - luma); m = 1 - scale * chroma; }
            }
            r = scale * r + m; g = scale * g + m; b = scale * b + m;
        } else if (toHue) {
            const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, lightness = (max + min) / 2;
            const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
            const hcl = target === "HCL" || target === "HCLp", luma = 0.298839 * r + 0.586811 * g + 0.114350 * b;
            // ImageMagick HWB uses -1 for achromatic hue, 1 for red, and an HDRI epsilon for zero blackness.
            r = hwb ? !delta ? -1 : hue === 0 ? 1 : hue / 6 : hue / 6; g = hcl ? delta : hwb ? min : delta ? delta / (hsb ? max : 1 - Math.abs(2 * lightness - 1)) : 0; b = hcl ? luma : hwb ? Math.max(2 ** -64, 1 - max) : hsb ? max : lightness;
        } else if (hwb && r === -1) {
            // Achromatic HWB ignores whiteness, including after channel edits.
            r = g = b = 1 - b;
        } else {
            // HSL arithmetic can move hue outside one turn in either direction.
            if (image.magickColorspace === "HSL") r -= Math.floor(r);
            // Edited HWB channels can sum above one; native preserves the negative chroma.
            const hue = (r < 0 || r === 1 ? 0 : r) * 6, chroma = hwb ? 1 - g - b : (hsb ? b : 1 - Math.abs(2 * b - 1)) * g, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = hwb ? g : b - chroma / (hsb ? 1 : 2);
            [r, g, b] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
            r += m; g += m; b += m;
        }
        for (const [channel, sample] of [r, g, b, input[offset + 3]! / range].entries()) {
            // Q16-HDRI stores these conversions as float quantum samples; YCbCr
            // neutral chroma must round to exactly half-range before palette classification.
            const value = target === "ProPhoto" || image.magickColorspace === "ProPhoto" ? Math.fround(sample * 65535) / 65535
                : target === "Luv" || image.magickColorspace === "Luv" || target === "Adobe98" || image.magickColorspace === "Adobe98" || target === "XYZ" || image.magickColorspace === "XYZ" ? Math.fround(sample * 65535) / 65535
                : (rec601 || ohta) && channel < 3 ? Math.fround(Math.max(0, Math.min(1, sample)) * 65535) / 65535
                : target === "DisplayP3" || image.magickColorspace === "DisplayP3" || target === "CAT02LMS" || image.magickColorspace === "CAT02LMS" || target === "YIQ" || target === "YDbDr" || image.magickColorspace === "YIQ" || image.magickColorspace === "YDbDr" || target === "Rec709YCbCr" || image.magickColorspace === "Rec709YCbCr" || lch || sourceLch || target === "Jzazbz" || image.magickColorspace === "Jzazbz" || target === "xyY" || image.magickColorspace === "xyY" || target === "Oklch" || image.magickColorspace === "Oklch" || target === "Oklab" || image.magickColorspace === "Oklab" || target === "CIELab" || image.magickColorspace === "CIELab" || target === "HSI" || image.magickColorspace === "HSI" || target === "HSL" || image.magickColorspace === "HSL" || (target === "YPbPr" || target === "YCbCr") || (image.magickColorspace === "YPbPr" || image.magickColorspace === "YCbCr") || image.magickColorspace === "YCC"
                ? Math.fround(sample * 65535) / 65535 : sample;
            if (hueSamples) hueSamples[offset + channel] = value;
            if (evaluateSamples) evaluateSamples[offset + channel] = value * 255;
            data16[offset + channel] = Math.round(Math.max(0, Math.min(1, value)) * 65535);
            data[offset + channel] = Math.round(Math.max(0, Math.min(1, value)) * 255);
        }
    }
    const { magickColorspace: ignored, hueSamples: ignoredSamples, storedHueSamples: ignoredStored, evaluateSamples: ignoredEvaluate, ...metadata } = image;
    return { ...metadata, data, data16, ...(evaluateSamples ? { evaluateSamples } : {}), space: "srgb", channels: image.hasAlpha ? 4 : 3, ...(hueSamples ? { magickColorspace: target as "HCL" | "HCLp" | "HSI" | "HSL" | "HSB" | "HSV" | "HWB" | "DisplayP3" | "XYZ" | "CAT02LMS" | "LMS" | "xyY" | "ProPhoto" | "Jzazbz" | "CIELab" | "YPbPr" | "YCbCr" | "Rec601YCbCr" | "YCC" | "Rec709YCbCr" | "Log" | "Adobe98" | "OHTA" | "CMY" | "YUV" | "YIQ" | "YDbDr" | "Luv" | "LCH" | "LCHab" | "LCHuv" | "Oklch" | "Oklab", hueSamples } : {}) };
}

export function formatHuePixel(channels: readonly number[], space: "HCL" | "HCLp" | "HSI" | "HSL" | "HSB" | "HSV" | "HWB" | "DisplayP3" | "XYZ" | "CAT02LMS" | "LMS" | "xyY" | "ProPhoto" | "Jzazbz" | "CIELab" | "YPbPr" | "YCbCr" | "Rec601YCbCr" | "YCC" | "Rec709YCbCr" | "Log" | "Adobe98" | "OHTA" | "CMY" | "YUV" | "YIQ" | "YDbDr" | "Luv" | "LCH" | "LCHab" | "LCHuv" | "Oklch" | "Oklab", hasAlpha: boolean, precision = 6): string {
    if (space === "Adobe98") return `adobe98${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map(value => `${Number((value * 100).toPrecision(precision))}%`).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    if (space === "DisplayP3") {
        const rgb = channels.slice(0, 3).map(value => value * 255);
        const fractional = rgb.some(value => Math.abs(value - Math.round(value)) > 1e-9);
        const color = rgb.map(value => fractional ? `${Number((value * 100 / 255).toPrecision(precision))}%` : String(Math.round(value))).join(",");
        return `displayp3${hasAlpha ? "a" : ""}(${color}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    }
    if (space === "ProPhoto") {
        const percent = channels.slice(0, 3).some(value => Math.abs(value * 255 - Math.round(value * 255)) > 1e-6);
        const values = channels.slice(0, 3).map(value => `${Number((value * (percent ? 100 : 255)).toPrecision(precision))}${percent ? "%" : ""}`);
        return `prophoto${hasAlpha ? "a" : ""}(${values.join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    }
    if (space === "CIELab" || space === "Oklab") return `${space.toLowerCase()}${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map((value, index) => Number((index === 0 ? value * 100 : (value - (index === 1 || space === "CIELab" ? 0.5 : 0)) * 255).toPrecision(precision))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    if (space === "LCH" || space === "LCHab" || space === "LCHuv") return `${space.toLowerCase()}${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map((value, index) => Number((index === 0 ? value * 100 : index === 1 ? (value - 0.5) * 255 : value * 360).toPrecision(precision))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    if (space === "Oklch") return `oklch${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map((value, index) => Number((index === 2 ? value * 180 / Math.PI : value).toPrecision(precision))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    if (space === "XYZ") return `xyz${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map(value => Number((value * 100).toPrecision(precision))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    if (space === "Jzazbz" || space === "LMS" || space === "CAT02LMS" || space === "xyY" || space === "Log" || space === "HWB" || (space === "YPbPr" || space === "YCbCr") || space === "Rec601YCbCr" || space === "YCC" || space === "Rec709YCbCr" || space === "OHTA" || space === "CMY" || space === "YUV" || space === "YIQ" || space === "YDbDr" || space === "Luv") return `${space.toLowerCase()}${hasAlpha ? "a" : ""}(${channels.slice(0, 3).map(value => Number((value * 255).toPrecision(precision))).join(",")}${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
    return `${space.toLowerCase()}${hasAlpha ? "a" : ""}(${Number((channels[0]! * 360).toPrecision(precision))},${Number((channels[1]! * 100).toPrecision(precision))}%,${Number((channels[2]! * 100).toPrecision(precision))}%${hasAlpha ? `,${formatMetricNum(channels[3] ?? 1)}` : ""})`;
}

export function* prepareHueOutput(image: RgbaImage & HueMetadata, format: string): Generator<void, RgbaImage & HueMetadata, void> {
    if (format === "farbfeld" || format === "pfm" || format === "phm") return image;
    if (format === "miff" || format === "pam") return image;
    if (image.magickColorspace === "CIELab" && format === "tiff") throw new Error("unsupported colorspace 'Lab' for TIFF output");
    if (image.magickColorspace !== "Jzazbz" && image.magickColorspace !== "Log" && image.magickColorspace !== "LCH" && image.magickColorspace !== "LCHab" && image.magickColorspace !== "LCHuv" && image.magickColorspace !== "Oklch" && image.magickColorspace !== "CIELab" && image.magickColorspace !== "HCL" && image.magickColorspace !== "HCLp" && image.magickColorspace !== "HSI" && image.magickColorspace !== "HSL" && image.magickColorspace !== "HSB" && image.magickColorspace !== "HSV" && image.magickColorspace !== "HWB" && image.magickColorspace !== "LMS" && image.magickColorspace !== "CAT02LMS" && image.magickColorspace !== "XYZ" && image.magickColorspace !== "xyY" && image.magickColorspace !== "ProPhoto" && image.magickColorspace !== "YPbPr" && image.magickColorspace !== "YCbCr" && image.magickColorspace !== "Rec601YCbCr" && image.magickColorspace !== "YCC" && image.magickColorspace !== "Rec709YCbCr" && image.magickColorspace !== "OHTA" && image.magickColorspace !== "CMY" && image.magickColorspace !== "YUV" && image.magickColorspace !== "YIQ" && image.magickColorspace !== "YDbDr" && image.magickColorspace !== "Luv" && image.magickColorspace !== "Oklab") return image;
    if (format === "tiff" || format === "raw" || image.magickColorspace === "ProPhoto") {
        const { magickColorspace: ignored, hueSamples: ignoredSamples, storedHueSamples: ignoredStored, ...output } = image;
        return output;
    }
    return yield* convertHuePixels(image, "sRGB");
}

export function hueTextPixel(values: readonly number[], hasAlpha: boolean, space: "HCL" | "HCLp" | "HSI" | "HSL" | "HSB" | "HSV" | "HWB" | "DisplayP3" | "XYZ" | "CAT02LMS" | "LMS" | "xyY" | "ProPhoto" | "Jzazbz" | "CIELab" | "YPbPr" | "YCbCr" | "Rec601YCbCr" | "YCC" | "Rec709YCbCr" | "Log" | "Adobe98" | "OHTA" | "CMY" | "YUV" | "YIQ" | "YDbDr" | "Luv" | "LCH" | "LCHab" | "LCHuv" | "Oklch" | "Oklab", samples?: readonly number[], maximum = 65535): string {
    const channels = values.slice(0, hasAlpha ? 4 : 3).map(value => Math.round(value * maximum / 65535));
    const color = formatHuePixel((space === "DisplayP3" || space === "Adobe98" || space === "Jzazbz" || space === "Log" || space === "LCH" || space === "LCHab" || space === "LCHuv" || space === "Oklch" || space === "HCL" || space === "HCLp" || space === "HSI" || space === "HSL" || space === "HWB" || space === "CAT02LMS" || space === "XYZ" || space === "LMS" || space === "xyY" || space === "ProPhoto" || space === "CIELab" || (space === "YPbPr" || space === "YCbCr") || space === "Rec601YCbCr" || space === "YCC" || space === "Rec709YCbCr" || space === "OHTA" || space === "CMY" || space === "YUV" || space === "YIQ" || space === "YDbDr" || space === "Luv" || space === "Oklab") && samples ? samples : values.map(value => value / 65535), space, true);
    const spelling = hasAlpha ? color : `${space.toLowerCase()}(${color.slice(color.indexOf("(") + 1, color.lastIndexOf(","))})`;
    return `(${channels.join(",")})  #${channels.map(value => value.toString(16).toUpperCase().padStart(maximum === 255 ? 2 : 4, "0")).join("")}  ${spelling}`;
}
