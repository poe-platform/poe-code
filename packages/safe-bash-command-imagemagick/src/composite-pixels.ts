import type { RgbaImage } from "@poe-code/image-ast/portable";

// ImageMagick compose names, including legacy aliases and our Source alias.
export const magickComposeNames = [
    "Atop", "Blend", "Blur", "Bumpmap", "ChangeMask", "Clear", "ColorBurn", "ColorDodge", "Colorize",
    "CopyAlpha", "CopyBlack", "CopyBlue", "Copy", "CopyCyan", "CopyGreen", "CopyMagenta", "CopyRed", "CopyYellow",
    "Darken", "DarkenIntensity", "Difference", "Displace", "Dissolve", "Distort", "DivideDst", "DivideSrc",
    "DstAtop", "Dst", "DstIn", "DstOut", "DstOver", "Exclusion", "Freeze", "HardLight", "HardMix", "Hue", "In",
    "Intensity", "Interpolate", "LightenIntensity", "Lighten", "LinearBurn", "LinearDodge", "LinearLight", "Luminize",
    "Mathematics", "MinusDst", "MinusSrc", "Modulate", "ModulusAdd", "ModulusSubtract", "Multiply", "Negate", "None",
    "Out", "Overlay", "Over", "PegtopLight", "PinLight", "Plus", "Reflect", "Replace", "RMSE", "Saturate", "Screen",
    "SaliencyBlend", "SeamlessBlend", "SoftBurn", "SoftDodge", "SoftLight", "SrcAtop", "SrcIn", "SrcOut", "SrcOver",
    "Src", "Stamp", "Stereo", "Threshold", "VividLight", "Xor", "CopyOpacity", "Add", "Subtract", "Minus", "Divide", "Undefined", "Source"
];

type CompositeRaster = Pick<RgbaImage, "width" | "height" | "hasAlpha"> & { data: Uint8Array | Float64Array };

export function magickCompositeMode(mode: string): { name: string; delegated: boolean; preservesAlpha: boolean } {
    let name = "";
    for (const character of mode.toLowerCase()) if (character !== "-" && character !== "_" && character.trim()) name += character;
    return { name, delegated: ["over", "srcover", "add"].includes(name),
        preservesAlpha: ["lightenintensity", "darkenintensity", "intensity", "difference", "src", "source", "copy", "xor", "blend", "dissolve", "in", "srcin", "out", "srcout", "dstin", "destin", "dstout", "destout"].includes(name) };
}

export function* compositePixelsSteps(dst: CompositeRaster, src: CompositeRaster, out: Uint8Array | Float64Array, modeRaw: string, left: number, top: number, composeArgs?: string, fuzz = 0, clipToOverlay = false): Generator<undefined, void, unknown> {
    let cooperativeWork = 0;
    const { name: norm } = magickCompositeMode(modeRaw);
    const modulation = norm === "modulate" ? (composeArgs || "100").toLowerCase().replaceAll(",", "x").split("x") : [];
    const lumaScale = Number.parseFloat(modulation[0] ?? "100") / 100;
    const chromaScale = Number.parseFloat(modulation[1] ?? "100") / 100;
    const [product = 0, source = 0, destination = 0, constant = 0] = norm === "mathematics"
        ? (composeArgs ?? "").toLowerCase().replaceAll("x", ",").split(",").map(Number) : [];
    const [thresholdAmount = 0.5, threshold = 0.05] = norm === "threshold" && composeArgs !== undefined
        ? composeArgs.toLowerCase().replaceAll("x", ",").split(",").map(Number) : [];
    // Float64 destinations retain fractional samples until output quantization.
    const clampByteVal = (value: number) => Number.isFinite(value)
        ? Math.max(0, Math.min(255, out instanceof Uint8Array ? Math.round(value) : value)) : 0;
    out.set(dst.data);
    const dw = dst.width;
    const dh = dst.height;
    const sw = src.width;
    const sh = src.height;
    const maskDestination = ["dstin", "destin", "srcin", "in", "srcout", "out", "dstatop", "destatop"].includes(norm);
    const extendSource = !clipToOverlay && (maskDestination || ["src", "source", "copy"].includes(norm));
    for (let sy = extendSource ? -top : 0; sy < (extendSource ? dh - top : sh); sy++) {
        if (++cooperativeWork % 65536 === 0)
            yield;
        const dy = top + sy;
        if (dy < 0 || dy >= dh)
            continue;
        for (let sx = extendSource ? -left : 0; sx < (extendSource ? dw - left : sw); sx++) {
            if (++cooperativeWork % 65536 === 0)
                yield;
            const dx = left + sx;
            if (dx < 0 || dx >= dw)
                continue;
            const sIdx = (Math.max(0, Math.min(sh - 1, sy)) * sw + Math.max(0, Math.min(sw - 1, sx))) * 4;
            const dIdx = (dy * dw + dx) * 4;
            if (maskDestination && (sx < 0 || sx >= sw || sy < 0 || sy >= sh)) {
                if (dst.hasAlpha) out[dIdx + 3] = 0;
                continue;
            }
            const sr = src.data[sIdx]!;
            const sg = src.data[sIdx + 1]!;
            const sb = src.data[sIdx + 2]!;
            const saByte = src.data[sIdx + 3]!;
            const dr = dst.data[dIdx]!;
            const dg = dst.data[dIdx + 1]!;
            const db = dst.data[dIdx + 2]!;
            const daByte = dst.data[dIdx + 3]!;
            const sa = saByte / 255;
            const da = daByte / 255;
            if (norm === "over" || norm === "srcover") {
                const alpha = sa + da * (1 - sa);
                if (alpha === 0) out.fill(0, dIdx, dIdx + 4);
                if (sa > 0) {
                    for (let channel = 0; channel < 3; channel++) {
                        out[dIdx + channel] = clampByteVal((src.data[sIdx + channel]! * sa
                            + dst.data[dIdx + channel]! * da * (1 - sa)) / alpha);
                    }
                    out[dIdx + 3] = clampByteVal(alpha * 255);
                }
                continue;
            }
            if (norm === "stereo") {
                out[dIdx] = sr;
                out[dIdx + 3] = clampByteVal((saByte + daByte) / 2);
                continue;
            }
            if (norm === "mathematics") {
                const alpha = sa + da - sa * da;
                for (let c = 0; c < 3; c++) {
                    const sc = src.data[sIdx + c]! / 255 * sa;
                    const dc = dst.data[dIdx + c]! / 255 * da;
                    const blended = product * sc * dc + source * sc * da + destination * dc * sa
                        + constant * sa * da + sc * (1 - da) + dc * (1 - sa);
                    out[dIdx + c] = alpha === 0 ? 0 : clampByteVal(255 * blended / alpha);
                }
                out[dIdx + 3] = clampByteVal(alpha * 255);
                continue;
            }
            if (norm === "threshold") {
                for (let c = 0; c < 3; c++) {
                    const sc = sa > 0 ? src.data[sIdx + c]! / 255 : 0;
                    const dc = da > 0 ? dst.data[dIdx + c]! / 255 : 0;
                    // Native compares normalized colors against a Q16-scaled threshold.
                    const blend = Math.abs(2 * (sc - dc)) < threshold * 65535
                        ? dc : dc + (sc - dc) * thresholdAmount;
                    out[dIdx + c] = clampByteVal(255 * (sa * da * Math.max(0, Math.min(1, blend))
                        + sc * sa * (1 - da) + dc * da * (1 - sa)));
                }
                out[dIdx + 3] = 255;
                continue;
            }
            if (norm === "rmse") {
                // ImageMagick divides only the blue squared difference by three.
                const gray = clampByteVal(Math.sqrt((dr - sr) ** 2 + (dg - sg) ** 2 + (db - sb) ** 2 / 3));
                for (let c = 0; c < 3; c++) {
                    out[dIdx + c] = saByte === 0 ? dst.data[dIdx + c]!
                        : daByte === 0 ? src.data[sIdx + c]! : gray;
                }
                out[dIdx + 3] = Math.max(saByte, daByte);
                continue;
            }
            if (norm === "changemask") {
                const distance = (saByte - daByte) ** 2
                    + ((sr - dr) ** 2 + (sg - dg) ** 2 + (sb - db) ** 2) * sa * da;
                if (distance <= 2 * fuzz ** 2) out[dIdx + 3] = 0;
                continue;
            }
            if (norm === "lightenintensity" || norm === "darkenintensity") {
                const sourceIntensity = 0.212656 * sr + 0.715158 * sg + 0.072186 * sb;
                const destinationIntensity = 0.212656 * dr + 0.715158 * dg + 0.072186 * db;
                for (let c = 0; c < 3; c++) {
                    if (norm === "lightenintensity") {
                        out[dIdx + c] = sourceIntensity > destinationIntensity ? src.data[sIdx + c]! : dst.data[dIdx + c]!;
                    } else {
                        const source = src.data[sIdx + c]! * sa;
                        const destination = dst.data[dIdx + c]! * da;
                        // ImageMagick 7.1.2 Q16 uses quantum-scale intensities in this blend.
                        out[dIdx + c] = clampByteVal(Math.min(source, destination)
                            + source * (1 - destinationIntensity * 257) + destination * (1 - sourceIntensity * 257));
                    }
                }
                // Native writes normalized alpha as a Q16 quantum, not a full-range alpha.
                const sourceWins = norm === "lightenintensity"
                    ? sa * sourceIntensity > da * destinationIntensity : sa * sourceIntensity < da * destinationIntensity;
                if (dst.hasAlpha) out[dIdx + 3] = clampByteVal((sourceWins ? sa : da) / 257);
                continue;
            }
            if (norm === "intensity") {
                if (dst.hasAlpha) out[dIdx + 3] = clampByteVal(0.212656 * sr + 0.715158 * sg + 0.072186 * sb);
                continue;
            }
            if (norm === "bumpmap") {
                // Native Rec.709 intensity scales alpha even when the source is transparent.
                const intensity = (0.212656 * sr + 0.715158 * sg + 0.072186 * sb) / 255;
                if (saByte !== 0) {
                    out[dIdx] = clampByteVal(dr * intensity);
                    out[dIdx + 1] = clampByteVal(dg * intensity);
                    out[dIdx + 2] = clampByteVal(db * intensity);
                }
                out[dIdx + 3] = clampByteVal(daByte * intensity);
                continue;
            }
            if (norm === "dividesrc") {
                const alpha = sa + da - sa * da;
                for (let c = 0; c < 3; c++) {
                    const source = src.data[sIdx + c]! / 255 * sa;
                    const destination = dst.data[dIdx + c]! / 255 * da;
                    // ImageMagick divides premultiplied channels before alpha normalization.
                    const channel = destination === 0 ? 1 - da
                        : destination / source + destination * (1 - sa) + source * (1 - da);
                    out[dIdx + c] = clampByteVal(Math.min(1, channel / Math.max(alpha, 1e-12)) * 255);
                }
                out[dIdx + 3] = clampByteVal(alpha * 255);
                continue;
            }
            if (norm === "dstover" || norm === "destover") {
                const sourceAlpha = sa * (1 - da);
                const alpha = da + sourceAlpha;
                for (let c = 0; c < 3; c++) {
                    out[dIdx + c] = alpha === 0 ? 0 : clampByteVal((dst.data[dIdx + c]! * da + src.data[sIdx + c]! * sourceAlpha) / alpha);
                }
                out[dIdx + 3] = clampByteVal(alpha * 255);
                continue;
            }
            if (norm === "colorize" || norm === "luminize") {
                if (saByte === 0) continue;
                if (daByte === 0) {
                    out.set(src.data.subarray(sIdx, sIdx + 4), dIdx);
                    continue;
                }
                // HCL: Colorize takes source hue/chroma; Luminize takes source Rec.601 luma.
                const lumaShift = 0.298839 * (dr - sr) + 0.586811 * (dg - sg) + 0.114350 * (db - sb);
                out[dIdx] = clampByteVal(norm === "colorize" ? sr + lumaShift : dr - lumaShift);
                out[dIdx + 1] = clampByteVal(norm === "colorize" ? sg + lumaShift : dg - lumaShift);
                out[dIdx + 2] = clampByteVal(norm === "colorize" ? sb + lumaShift : db - lumaShift);
                out[dIdx + 3] = Math.max(saByte, daByte);
                continue;
            }
            if (norm === "saturate" || norm === "hue") {
                if (saByte === 0) continue;
                if (daByte === 0) {
                    out.set(src.data.subarray(sIdx, sIdx + 4), dIdx);
                    continue;
                }
                // HCL: replace hue or chroma while preserving destination Rec.601 luma.
                const sourceChroma = Math.max(sr, sg, sb) - Math.min(sr, sg, sb);
                const destinationChroma = Math.max(dr, dg, db) - Math.min(dr, dg, db);
                const luma = 0.298839 * dr + 0.586811 * dg + 0.114350 * db;
                const hueFromSource = norm === "hue";
                const hueChroma = hueFromSource ? sourceChroma : destinationChroma;
                const chroma = hueFromSource ? destinationChroma : sourceChroma;
                const hueLuma = hueFromSource ? 0.298839 * sr + 0.586811 * sg + 0.114350 * sb : luma;
                const scale = hueChroma === 0 ? 0 : chroma / hueChroma;
                out[dIdx] = clampByteVal(luma + (hueChroma === 0 ? 0.701161 * chroma : ((hueFromSource ? sr : dr) - hueLuma) * scale));
                out[dIdx + 1] = clampByteVal(luma + (hueChroma === 0 ? -0.298839 * chroma : ((hueFromSource ? sg : dg) - hueLuma) * scale));
                out[dIdx + 2] = clampByteVal(luma + (hueChroma === 0 ? -0.298839 * chroma : ((hueFromSource ? sb : db) - hueLuma) * scale));
                out[dIdx + 3] = Math.max(saByte, daByte);
                continue;
            }
            if (norm === "plus") {
                // ImageMagick adds alpha-weighted channels without unpremultiplying.
                out[dIdx] = clampByteVal(sr * sa + dr * da);
                out[dIdx + 1] = clampByteVal(sg * sa + dg * da);
                out[dIdx + 2] = clampByteVal(sb * sa + db * da);
                out[dIdx + 3] = clampByteVal(saByte + daByte);
                continue;
            }
            if (norm === "dividedst") {
                const alpha = sa + da - sa * da;
                for (let c = 0; c < 3; c++) {
                    // ImageMagick divides premultiplied channels, then unpremultiplies.
                    const sc = src.data[sIdx + c]! / 255 * sa;
                    const dc = dst.data[dIdx + c]! / 255 * da;
                    const channel = dc === 0 ? sc + (1 - sa) : sc / dc + sc * (1 - da) + dc * (1 - sa);
                    out[dIdx + c] = clampByteVal(255 * channel / (alpha || 1e-12));
                }
                out[dIdx + 3] = clampByteVal(alpha * 255);
                continue;
            }
            if (norm === "minussrc") {
                const alpha = sa + da - sa * da;
                for (let c = 0; c < 3; c++) {
                    // Subtract source in the overlap, retaining both outside contributions.
                    const channel = dst.data[dIdx + c]! * da + src.data[sIdx + c]! * sa * (1 - 2 * da);
                    out[dIdx + c] = alpha === 0 ? 0 : clampByteVal(channel / alpha);
                }
                out[dIdx + 3] = clampByteVal(alpha * 255);
                continue;
            }
            if (norm === "minus" || norm === "minusdst") {
                const alpha = sa + da - sa * da;
                for (let c = 0; c < 3; c++) {
                    // Subtract destination in the overlap, retaining both outside contributions.
                    const channel = src.data[sIdx + c]! * sa + dst.data[dIdx + c]! * da * (1 - 2 * sa);
                    out[dIdx + c] = alpha === 0 ? 0 : clampByteVal(channel / alpha);
                }
                out[dIdx + 3] = clampByteVal(alpha * 255);
                continue;
            }
            if (norm === "dissolve") {
                const [sStr, dStr] = (composeArgs || "100").split(/[xX,]/);
                const sMod = Math.max(0, Math.min(1, (parseFloat(sStr || "100") || 0) / 100));
                const dMod = dStr !== undefined ? Math.max(0, Math.min(1, (parseFloat(dStr) || 0) / 100)) : 1;
                const effSa = sa * sMod;
                const effDa = da * dMod;
                const outA = effSa + effDa * (1 - effSa);
                if (outA <= 1e-6) {
                    out[dIdx] = 0;
                    out[dIdx + 1] = 0;
                    out[dIdx + 2] = 0;
                    out[dIdx + 3] = 0;
                }
                else {
                    out[dIdx] = clampByteVal((sr * effSa + dr * effDa * (1 - effSa)) / outA);
                    out[dIdx + 1] = clampByteVal((sg * effSa + dg * effDa * (1 - effSa)) / outA);
                    out[dIdx + 2] = clampByteVal((sb * effSa + db * effDa * (1 - effSa)) / outA);
                    out[dIdx + 3] = clampByteVal(outA * 255);
                }
                continue;
            }
            if (norm === "modulate") {
                if (saByte === 0) continue;
                // Native Q16 watermark uses a truncated intensity offset from midpoint.
                const offset = Math.trunc((0.212656 * sr + 0.715158 * sg + 0.072186 * sb) * 257 - 32768);
                if (offset === 0) continue;
                const lumaShift = lumaScale * offset / 32768 * 255;
                // Scaling HCL chroma at fixed hue scales RGB distance from Rec.601 luma.
                const luma = 0.298839 * dr + 0.586811 * dg + 0.114350 * db;
                out[dIdx] = clampByteVal(luma + (dr - luma) * chromaScale + lumaShift);
                out[dIdx + 1] = clampByteVal(luma + (dg - luma) * chromaScale + lumaShift);
                out[dIdx + 2] = clampByteVal(luma + (db - luma) * chromaScale + lumaShift);
                continue;
            }
            if (norm === "blend") {
                const [sStr, dStr] = (composeArgs ?? "100x100").split(/[xX,]/);
                const wSrc = Math.max(0, (parseFloat(sStr || "50") || 0) / 100);
                const wDst = dStr !== undefined ? Math.max(0, (parseFloat(dStr) || 0) / 100) : Math.max(0, 1 - wSrc);
                const effSa = sa * wSrc;
                const effDa = da * wDst;
                const alpha = effSa + effDa;
                out[dIdx] = alpha === 0 ? 0 : clampByteVal((sr * effSa + dr * effDa) / alpha);
                out[dIdx + 1] = alpha === 0 ? 0 : clampByteVal((sg * effSa + dg * effDa) / alpha);
                out[dIdx + 2] = alpha === 0 ? 0 : clampByteVal((sb * effSa + db * effDa) / alpha);
                out[dIdx + 3] = dst.hasAlpha ? clampByteVal(saByte * wSrc + daByte * wDst) : daByte;
                continue;
            }
            if (norm === "src" || norm === "source" || norm === "copy") {
                out[dIdx] = sr;
                out[dIdx + 1] = sg;
                out[dIdx + 2] = sb;
                out[dIdx + 3] = dst.hasAlpha ? saByte : daByte;
                continue;
            }
            if (norm === "dst" || norm === "dest") {
                continue;
            }
            if (norm === "modulussubtract") {
                // Wrap source minus destination premultiplied RGB without unpremultiplying.
                for (let c = 0; c < 3; c++) {
                    const channel = src.data[sIdx + c]! * sa - dst.data[dIdx + c]! * da;
                    out[dIdx + c] = clampByteVal((channel + 255) % 255);
                }
                const alpha = saByte - daByte;
                out[dIdx + 3] = alpha < 0 ? alpha + 255 : alpha;
                continue;
            }
            if (norm === "modulusadd" || norm === "add") {
                // ImageMagick wraps premultiplied RGB, without alpha normalization.
                for (let c = 0; c < 3; c++) {
                    const channel = src.data[sIdx + c]! * sa + dst.data[dIdx + c]! * da;
                    out[dIdx + c] = clampByteVal(channel % 255);
                }
                const alpha = saByte + daByte;
                out[dIdx + 3] = alpha > 255 ? alpha - 255 : alpha;
                continue;
            }
            if (norm === "clear") {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
                continue;
            }
            if (norm === "copyopacity" || norm === "copyalpha") {
                out[dIdx + 3] = src.hasAlpha ? saByte : clampByteVal(0.212656 * sr + 0.715158 * sg + 0.072186 * sb);
                continue;
            }
            if (norm === "copyred") {
                out[dIdx] = sr;
                continue;
            }
            if (norm === "copygreen") {
                out[dIdx + 1] = sg;
                continue;
            }
            if (norm === "copyblue") {
                out[dIdx + 2] = sb;
                continue;
            }
            if (norm === "pegtoplight") {
                const alpha = sa + da - sa * da;
                for (let c = 0; c < 3; c++) {
                    const sc = Math.max(0, Math.min(1, src.data[sIdx + c]! / 255 * sa));
                    const dc = Math.max(0, Math.min(1, dst.data[dIdx + c]! / 255));
                    const blend = sc <= 0.5
                        ? dc - (1 - 2 * sc) * dc * (1 - dc)
                        : dc + (2 * sc - 1) * ((dc <= 0.25 ? ((16 * dc - 12) * dc + 4) * dc : Math.sqrt(dc)) - dc);
                    // Native PegtopLight omits the source's outside-destination contribution.
                    const channel = da === 0 ? sc : blend * da * sa + dc * da * (1 - sa);
                    out[dIdx + c] = alpha === 0 ? 0 : clampByteVal(255 * channel / alpha);
                }
                out[dIdx + 3] = clampByteVal(alpha * 255);
                continue;
            }
            if (norm === "softlight") {
                const alpha = sa + da - sa * da;
                for (let c = 0; c < 3; c++) {
                    // ImageMagick SoftLight uses premultiplied channel values,
                    // including its additional destination contribution.
                    const sc = src.data[sIdx + c]! / 255 * sa;
                    const dc = dst.data[dIdx + c]! / 255 * da;
                    const blend = sc <= 0.5
                        ? dc - (1 - 2 * sc) * dc * (1 - dc)
                        : dc + (2 * sc - 1) * ((dc > 0.25 ? Math.sqrt(dc) : ((16 * dc - 12) * dc + 4) * dc) - dc);
                    out[dIdx + c] = alpha === 0 ? 0 : clampByteVal(255 * (dc * sa + da * blend + sc * (1 - da) + dc * (1 - sa)) / alpha);
                }
                out[dIdx + 3] = clampByteVal(alpha * 255);
                continue;
            }
            if (norm === "difference") {
                if (saByte === 0)
                    continue;
                const alpha = sa + da - sa * da;
                for (let c = 0; c < 3; c++) {
                    const source = src.data[sIdx + c]!;
                    const destination = dst.data[dIdx + c]!;
                    const channel = Math.abs(source - destination) * sa * da
                        + source * sa * (1 - da) + destination * da * (1 - sa);
                    out[dIdx + c] = clampByteVal(channel / alpha);
                }
                out[dIdx + 3] = dst.hasAlpha ? Math.abs(saByte - daByte) : daByte;
                continue;
            }
            if (norm === "in" || norm === "srcin") {
                const factor = sa * da;
                out[dIdx] = clampByteVal(sr * factor);
                out[dIdx + 1] = clampByteVal(sg * factor);
                out[dIdx + 2] = clampByteVal(sb * factor);
                out[dIdx + 3] = dst.hasAlpha ? clampByteVal(factor * 255) : daByte;
                continue;
            }
            if (norm === "out" || norm === "srcout") {
                const factor = sa * (1 - da);
                out[dIdx] = clampByteVal(sr * factor);
                out[dIdx + 1] = clampByteVal(sg * factor);
                out[dIdx + 2] = clampByteVal(sb * factor);
                out[dIdx + 3] = dst.hasAlpha ? clampByteVal(factor * 255) : daByte;
                continue;
            }
            if (norm === "dstin" || norm === "destin") {
                const factor = sa * da;
                out[dIdx] = dr;
                out[dIdx + 1] = dg;
                out[dIdx + 2] = db;
                out[dIdx + 3] = dst.hasAlpha ? clampByteVal(factor * 255) : daByte;
                continue;
            }
            if (norm === "dstout" || norm === "destout") {
                const factor = da * (1 - sa);
                out[dIdx] = factor === 0 ? 0 : dr;
                out[dIdx + 1] = factor === 0 ? 0 : dg;
                out[dIdx + 2] = factor === 0 ? 0 : db;
                out[dIdx + 3] = dst.hasAlpha ? clampByteVal(factor * 255) : daByte;
                continue;
            }
            if (norm === "atop" || norm === "srcatop") {
                out[dIdx] = clampByteVal(sr * sa * da + dr * da * (1 - sa));
                out[dIdx + 1] = clampByteVal(sg * sa * da + dg * da * (1 - sa));
                out[dIdx + 2] = clampByteVal(sb * sa * da + db * da * (1 - sa));
                out[dIdx + 3] = daByte;
                continue;
            }
            if (norm === "dstatop" || norm === "destatop") {
                out[dIdx] = clampByteVal(dr * da * sa + sr * sa * (1 - da));
                out[dIdx + 1] = clampByteVal(dg * da * sa + sg * sa * (1 - da));
                out[dIdx + 2] = clampByteVal(db * da * sa + sb * sa * (1 - da));
                out[dIdx + 3] = saByte;
                continue;
            }
            if (norm === "xor") {
                const outA = sa * (1 - da) + da * (1 - sa);
                out[dIdx] = clampByteVal(sr * sa * (1 - da) + dr * da * (1 - sa));
                out[dIdx + 1] = clampByteVal(sg * sa * (1 - da) + dg * da * (1 - sa));
                out[dIdx + 2] = clampByteVal(sb * sa * (1 - da) + db * da * (1 - sa));
                out[dIdx + 3] = dst.hasAlpha ? clampByteVal(outA * 255) : daByte;
                continue;
            }
            if (norm === "lineardodge" ||
                norm === "linearburn" ||
                norm === "linearlight" ||
                norm === "colorburn" ||
                norm === "colordodge" ||
                norm === "multiply" ||
                norm === "screen" ||
                norm === "overlay" ||
                norm === "hardlight" ||
                norm === "pinlight" ||
                norm === "vividlight" ||
                norm === "hardmix" ||
                norm === "darken" ||
                norm === "lighten" ||
                norm === "exclusion") {
                const gamma = sa + da - sa * da;
                const sChan = [sr / 255, sg / 255, sb / 255];
                const dChan = [dr / 255, dg / 255, db / 255];
                for (let c = 0; c < 3; c++) {
                    if (++cooperativeWork % 65536 === 0)
                        yield;
                    const sc = sChan[c]!;
                    const dc = dChan[c]!;
                    if (norm === "darken") {
                        const comp = Math.min(sc * sa, dc * da) + sc * sa * (1 - da) + dc * da * (1 - sa);
                        out[dIdx + c] = clampByteVal(comp * 255);
                    }
                    else if (norm === "lighten") {
                        const comp = Math.max(sc, dc) * sa * da + sc * sa * (1 - da) + dc * da * (1 - sa);
                        out[dIdx + c] = clampByteVal(comp * 255);
                    }
                    else if (norm === "exclusion") {
                        const comp = sc * sa + dc * da - 2 * sc * dc * sa * da;
                        out[dIdx + c] = clampByteVal((gamma > 0 ? comp / gamma : 0) * 255);
                    }
                    else {
                        let f = 0;
                        if (norm === "lineardodge")
                            f = Math.min(1, sc + dc);
                        else if (norm === "linearburn")
                            f = Math.max(0, sc + dc - 1);
                        else if (norm === "linearlight")
                            f = Math.max(0, Math.min(1, dc + 2 * sc - 1));
                        else if (norm === "colorburn")
                            f = sc === 0 ? 0 : Math.max(0, 1 - (1 - dc) / sc);
                        else if (norm === "colordodge")
                            f = sc === 1 ? 1 : Math.min(1, dc / (1 - sc));
                        else if (norm === "multiply")
                            f = sc * dc;
                        else if (norm === "screen")
                            f = sc + dc - sc * dc;
                        else if (norm === "hardlight")
                            f = sc <= 0.5 ? 2 * sc * dc : 1 - 2 * (1 - sc) * (1 - dc);
                        else if (norm === "pinlight")
                            f = sc <= 0.5 ? Math.min(dc, 2 * sc) : Math.max(dc, 2 * sc - 1);
                        else if (norm === "hardmix")
                            f = sc + dc < 1 ? 0 : 1;
                        else if (norm === "vividlight")
                            f = sc <= 0.5
                                ? sc === 0 ? 0 : Math.max(0, 1 - (1 - dc) / (2 * sc))
                                : sc === 1 ? 1 : Math.min(1, dc / (2 * (1 - sc)));
                        else
                            f = dc <= 0.5 ? 2 * sc * dc : 1 - 2 * (1 - sc) * (1 - dc);
                        const comp = f * sa * da + sc * sa * (1 - da) + dc * da * (1 - sa);
                        const unpremul = gamma > 1e-6 && (norm === "lineardodge" || norm === "linearburn" || norm === "linearlight" || norm === "colorburn" || norm === "colordodge" || norm === "multiply" || norm === "screen" || norm === "overlay" || norm === "hardlight" || norm === "pinlight" || norm === "vividlight" || norm === "hardmix") ? comp / gamma : comp;
                        out[dIdx + c] = clampByteVal(unpremul * 255);
                    }
                }
                out[dIdx + 3] = clampByteVal(gamma * 255);
                continue;
            }
        }
    }
}
