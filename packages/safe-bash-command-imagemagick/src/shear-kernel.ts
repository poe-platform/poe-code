import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { regionContains, type Region } from "./region.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { compositePixelsSteps, magickCompositeMode } from "./composite-pixels.js";

/** Native shear uses pixel-edge centers and crops the bordered, sequential X/Y shear. */
export function shearPlan(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">, spec: string) {
    // Native geometry permits modifiers, but requires a complete first angle.
    const geometry = [...spec].filter(char => char.trim() !== "" && !"%!<>#^@()".includes(char)).join("");
    const separator = [...geometry].findIndex(char => "xX,:/".includes(char));
    const firstAngle = separator < 0 ? geometry : geometry.slice(0, separator);
    if (!firstAngle || !Number.isFinite(Number(firstAngle)) || [...geometry].some(char => !"0123456789eExX+,-./:".includes(char))) {
        throw new Error(`invalid argument for option '-shear': ${spec}`);
    }
    const [xAngle = 0, yAngle = xAngle] = spec.replaceAll("(", "").replaceAll(")", "").toLowerCase().replaceAll(",", "x").replaceAll("/", "x").split("x").map(value => value === "" ? undefined : parseFloat(value) || 0);
    if ((xAngle !== 0 && xAngle % 90 === 0) || (yAngle !== 0 && yAngle % 90 === 0)) throw new Error("angle is discontinuous");
    const tx = -Math.tan(xAngle * Math.PI / 180), ty = Math.tan(yAngle * Math.PI / 180);
    const w = image.width, h = image.height;
    const spanX = w + Math.abs(tx) * h, spanY = Math.abs(ty) * w + Math.abs(1 + tx * ty) * h;
    const width = Math.max(1, Math.round(spanX)), height = Math.max(1, Math.round(spanY));
    const borderX = Math.ceil(spanX / 2 - 0.5), borderY = Math.ceil((h + Math.abs(ty) * width) / 2 - 0.5);
    const fullWidth = w + 2 * borderX, fullHeight = h + 2 * borderY;
    return { width, height, hasAlpha: image.hasAlpha, tx, ty, borderX,
        offsetX: Math.ceil((fullWidth - spanX) / 2 - 0.5),
        offsetY: Math.ceil((fullHeight - spanY) / 2 - 0.5) - borderY,
        columnOffset: Math.floor((fullWidth - width) / 2) };
}

export function* shearPixelSteps(source: Pick<RgbaImage, "width" | "height" | "data16" | "hueSamples" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "space" | "storedData16" | "storedHueSamples" | "storedEvaluateSamples">> & { alphaSeparate?: boolean | undefined; alphaBlend?: boolean | undefined; region?: Region | undefined }, plan: ReturnType<typeof shearPlan>, background: RgbaColor, compose: string, composeArgs?: string, fuzz = 0, selected?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const hasAlpha = plan.hasAlpha || source.alphaSeparate === true && source.alphaBlend !== false;
    const cmyk = source.space === "cmyk";
    const hue = source.space !== "cmyk" && (!!source.hueSamples || source.storedHueSamples !== undefined);
    const evaluate = !hue && (!!source.evaluateSamples || source.storedEvaluateSamples !== undefined);
    const highDepth = !!(source.data16 || source.storedData16), scale = highDepth ? 257 : 1, maximum = 255 * scale;
    const bg = [background.r, background.g, background.b, background.a, 0].map(value => value * scale);
    const canvas = { width: 1, height: 1, hasAlpha, data: Float64Array.from(bg.slice(0, 4), value => value / scale) };
    const overlay = { ...canvas, data: new Float64Array(4) }, composite = new Float64Array(cmyk ? 5 : 4);
    const { name: composeMode } = magickCompositeMode(compose);
    const over = composeMode === "over" || composeMode === "srcover";
    function* readPixel(px: number, y: number): Generator<ConvolveRequest | undefined, ArrayLike<number>, Uint8Array | undefined> {
        if (px >= 0 && px < source.width && y >= 0 && y < source.height) {
            const bytes = yield { kind: "read", highDepth, hue, evaluate, position: (y * source.width + px) * 4, length: 4 };
            if (!bytes || bytes.length !== (hue || evaluate ? 32 : highDepth ? 8 : 4)) throw new Error("Truncated shear pixels");
            // Native BorderImage applies the selected compose operator before resampling.
            let samples: ArrayLike<number> = hue || evaluate ? Float64Array.from(new Float64Array(bytes.slice().buffer), value => value * (hue ? maximum : scale)) : highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, 4) : bytes;
            if (cmyk) {
                const inks = yield { kind: "read", hue: true, position: (y * source.width + px) * 4, length: 4 };
                if (!inks || inks.length !== 32) throw new Error("Truncated shear inks");
                const working = new Float64Array(inks.slice().buffer);
                samples = [working[0]! * maximum, working[1]! * maximum, working[2]! * maximum, samples[3]!, working[3]! * maximum];
            }
            // Shear activates opaque alpha before BorderImage; the region leaves selected
            // samples transparent. Existing active/discrete alpha keeps its stored opacity.
            const sourceAlpha = hasAlpha ? samples[3]! : source.region && regionContains(source.region, px, y) ? 0 : maximum;
            if (over) {
                const remaining = bg[3]! * (1 - sourceAlpha / maximum), alpha = sourceAlpha + remaining;
                for (let c = 0; c < 3; c++) composite[c] = alpha > 0 ? (samples[c]! * sourceAlpha + bg[c]! * remaining) / alpha : 0;
                composite[3] = alpha;
                if (cmyk) composite[4] = alpha > 0 ? samples[4]! * sourceAlpha / alpha : 0;
            } else {
                for (let c = 0; c < 4; c++) overlay.data[c] = samples[c]! / scale;
                overlay.data[3] = sourceAlpha / scale;
                yield* compositePixelsSteps(canvas, overlay, composite, compose, 0, 0, composeArgs, fuzz, true);
                for (let c = 0; c < 4; c++) composite[c]! *= scale;
                if (cmyk) {
                    const black = new Float64Array(4);
                    const inkCanvas = { ...canvas, data: Float64Array.of(0, 0, 0, bg[3]! / scale) };
                    const inkOverlay = { ...overlay, data: Float64Array.of(samples[4]! / scale, samples[4]! / scale, samples[4]! / scale, sourceAlpha / scale) };
                    yield* compositePixelsSteps(inkCanvas, inkOverlay, black, compose, 0, 0, composeArgs, fuzz, true);
                    composite[4] = black[0]! * scale;
                }
            }
            // BorderImage leaves unselected channels on its background canvas.
            for (let c = 0; c < composite.length; c++) if (selected && !selected[c]) composite[c] = bg[c]!;
            return composite.slice();
        }
        return bg;
    }
    function* horizontal(x: number, y: number): Generator<ConvolveRequest | undefined, number[], Uint8Array | undefined> {
        const displacement = plan.tx * (y - source.height / 2);
        const sx = x - plan.borderX - displacement, x0 = Math.floor(sx), fx = sx - x0;
        const channels = [0, 0, 0, 0, 0];
        for (let col = 0; col < 2; col++) {
            const weight = col === 0 ? 1 - fx : fx;
            if (weight === 0) continue;
            const pixel = yield* readPixel(x0 + col, y), alpha = weight * pixel[3]!;
            for (let c = 0; c < channels.length; c++) channels[c]! += c === 3 ? alpha : alpha * pixel[c]!;
        }
        for (const c of [0, 1, 2, 4]) channels[c] = channels[3]! > 1e-10 ? channels[c]! / channels[3]! : 0;
        // Native's final blend with its RGB background retains the preceding K result.
        const edge = displacement > 0 && x0 === -1 ? 1 : displacement < 0 && x0 === source.width - 1 ? -1 : 0;
        if (cmyk && edge && y >= 0 && y < source.height) {
            const a = yield* readPixel(x0 + edge, y), b = yield* readPixel(x0 + edge + 1, y);
            const alpha = (1 - fx) * a[3]! + fx * b[3]!;
            channels[4] = alpha > 1e-10 ? ((1 - fx) * a[3]! * a[4]! + fx * b[3]! * b[4]!) / alpha : 0;
        }
        return channels;
    }
    for (let start = 0; start < plan.width * plan.height; start += 1024) {
        yield;
        const count = Math.min(1024, plan.width * plan.height - start), data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const values = new Float64Array(count * 4), inks = cmyk ? new Float64Array(count * 4) : undefined;
        for (let i = 0; i < count; i++) {
            const x = (start + i) % plan.width + plan.offsetX;
            const column = x - plan.columnOffset;
            const displacement = column >= 0 && column < plan.width ? plan.ty * (column - plan.width / 2) : 0;
            const sy = Math.floor((start + i) / plan.width) + plan.offsetY - displacement;
            const y0 = Math.floor(sy), fy = sy - y0;
            const channels = [0, 0, 0, 0, 0];
            // Keep the horizontal blend unrounded until the vertical blend completes.
            // Premultiplied colors also interpolate correctly against transparent background.
            for (let row = 0; row < 2; row++) {
                const y = y0 + row, wy = row === 0 ? 1 - fy : fy;
                if (wy === 0) continue;
                const pixel = yield* horizontal(x, y), alpha = wy * pixel[3]!;
                for (let c = 0; c < channels.length; c++) channels[c]! += c === 3 ? alpha : alpha * pixel[c]!;
            }
            if (cmyk) {
                let black = channels[3]! > 1e-10 ? channels[4]! / channels[3]! : 0;
                const edge = displacement > 0 && y0 === -1 ? 1 : displacement < 0 && y0 === source.height - 1 ? -1 : 0;
                if (edge) {
                    const a = yield* horizontal(x, y0 + edge), b = yield* horizontal(x, y0 + edge + 1);
                    const alpha = (1 - fy) * a[3]! + fy * b[3]!;
                    black = alpha > 1e-10 ? ((1 - fy) * a[3]! * a[4]! + fy * b[3]! * b[4]!) / alpha : 0;
                }
                inks![i * 4 + 3] = Math.fround(black * 257 / scale) / 65535;
            }
            // Retain Q16-HDRI working samples even when the input has only eight bits.
            for (let c = 0; c < 4; c++) {
                const value = c === 3 ? channels[3]! : channels[3]! > 1e-10 ? channels[c]! / channels[3]! : 0;
                if (inks && c < 3) inks[i * 4 + c] = Math.fround(value * 257 / scale) / 65535;
                values[i * 4 + c] = inks && c < 3
                    ? Math.fround((1 - inks[i * 4 + c]!) * (1 - inks[i * 4 + 3]!) * 65535) / 257
                    : Math.fround(value * 257 / scale) / 257;
                data[i * 4 + c] = Math.round(values[i * 4 + c]! * scale);
            }
        }
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer) };
        if (inks) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(inks.buffer) };
        if (hue) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(values.map(value => value / 255).buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(values.buffer) };
    }
}
