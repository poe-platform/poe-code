import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { warpPixelSteps } from "./warp-kernel.js";

type Raster = Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "evaluateSamples" | "hueSamples" | "space"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedEvaluateSamples" | "storedHueSamples">>;

export function* distortCompositeSteps(base: Raster, overlay: Raster, left: number, top: number, args = "", tile = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const raw = [...args].filter(character => character.trim() && !"%!".includes(character)).join("");
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i < raw.length; i++) {
        if ("xX,/".includes(raw[i]!)) {
            parts.push(raw.slice(start, i));
            start = i + 1;
        } else if (i > start && "+-".includes(raw[i]!) && raw[i - 1]?.toLowerCase() !== "e") {
            parts.push(raw.slice(start, i));
            if (parts.length === 1) parts.push("");
            start = i;
        }
    }
    parts.push(raw.slice(start));
    const [width, height, cx, cy] = parts.map(part => part ? Number.parseFloat(part) : undefined);
    const relative = args.includes("!") ? base : overlay;
    let scaleX = width ?? (relative.width - 1) / 2, scaleY = height ?? scaleX;
    if (width === undefined && height === undefined) scaleY = (relative.height - 1) / 2;
    if (args.includes("%") && (width !== undefined || height !== undefined)) {
        scaleX = (width ?? 0) * (relative.width - 1) / 200;
        scaleY = height === undefined ? scaleX : height * (relative.height - 1) / 200;
    }
    const centerX = (args.includes("!") ? 0 : left) + (cx ?? (relative.width - 1) / 2);
    const centerY = (args.includes("!") ? 0 : top) + (cy ?? (relative.height - 1) / 2);
    const evaluate = !!overlay.evaluateSamples || overlay.storedEvaluateSamples !== undefined;
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width;) {
        yield;
        const sx = tile ? x % overlay.width : x - left, sy = tile ? y % overlay.height : y - top;
        const inside = sx >= 0 && sy >= 0 && sx < overlay.width && sy < overlay.height;
        const count = Math.min(512, base.width - x, sx < 0 ? -sx : sx < overlay.width ? overlay.width - sx : base.width - x);
        const bytes = inside ? (yield { kind: "read", image: 1, highDepth: true, evaluate,
            position: (sy * overlay.width + sx) * 4, length: count * 4 })! : undefined;
        const map = bytes === undefined ? undefined : evaluate ? new Float64Array(bytes.slice().buffer)
            : Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257);
        const sampler = warpPixelSteps(base, {
            width: count, height: 1, hasAlpha: base.hasAlpha,
            map(i) {
                if (!map) return [-1, -1];
                // Native Q16 maps are centered at 32768, not half of 65535.
                return [centerX + scaleX * (map[i * 4]! * 257 - 32768) / 32768,
                    centerY + scaleY * (map[i * 4 + 1]! * 257 - 32768) / 32768];
            },
        }, { r: 0, g: 0, b: 0, a: base.hasAlpha ? 0 : 255 }, inside ? "edge" : "background");
        let input: Uint8Array | undefined;
        for (;;) {
            const next = sampler.next(input);
            if (next.done) break;
            const request = next.value;
            if (request?.kind !== "write") { input = yield request; continue; }
            if (map && base.hasAlpha && overlay.hasAlpha && !request.hue) {
                const data = request.evaluate ? new Float64Array(request.data.buffer, request.data.byteOffset, request.data.byteLength / 8)
                    : request.highDepth ? new Uint16Array(request.data.buffer, request.data.byteOffset, request.data.byteLength / 2) : request.data;
                for (let i = 3; i < data.length; i += 4) {
                    const alpha = data[i]! * map[i]! / 255;
                    data[i] = request.evaluate ? Math.fround(alpha * 257) / 257 : Math.round(alpha);
                }
            }
            input = yield { ...request, position: request.position + (y * base.width + x) * 4 };
        }
        x += count;
    }
}
