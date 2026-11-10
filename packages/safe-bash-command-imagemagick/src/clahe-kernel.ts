import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { convertHuePixels, type HueMetadata } from "./colorspace-hue.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function parseClaheGeometry(raw: string) {
    const value = raw.trim(), parts: string[] = [];
    let start = 0;
    for (let i = 0; i < value.length; i++) {
        const c = value[i]!;
        if (!"0123456789.xX+-%!eE".includes(c)) throw new Error("Invalid CLAHE geometry");
        if ((c === "+" || c === "-") && value[i - 1]?.toLowerCase() !== "e") {
            parts.push(value.slice(start, i)); start = i;
        }
    }
    parts.push(value.slice(start));
    const dimensions = parts[0]!.replaceAll("%", "").replaceAll("!", "").toLowerCase().split("x");
    const width = dimensions[0] ? Number(dimensions[0]) : undefined;
    const height = dimensions[1] ? Number(dimensions[1]) : undefined;
    const bins = parts[1] === undefined ? 128 : Number(parts[1]);
    const clip = parts[2] === undefined ? 0 : Number(parts[2]);
    if (!value || dimensions.length > 2 || parts.length > 3 || ![width ?? 0, height ?? 0, bins, clip].every(n => Number.isFinite(n) && n >= 0)
        || parts.slice(1).some(part => part.length < 2)) throw new Error("Invalid CLAHE geometry");
    // Native geometry parsing leaves defaults intact for a width followed directly by offsets.
    if (dimensions.length === 1 && width !== undefined && parts.length > 1)
        return { width: undefined, height: undefined, bins: 128, clip: 0, percent: false, exact: false };
    return { width, height, bins: bins === 0 ? 128 : Math.min(256, Math.trunc(bins)), clip, percent: value.includes("%"), exact: value.includes("!") };
}

/** ImageMagick CLAHE: clipped tile histograms of Q16 Lab lightness, interpolated at tile centers. */
export function* clahePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "format" | "space" | "channels" | "depth" | "density" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">> & HueMetadata,
    geometry: ReturnType<typeof parseClaheGeometry>, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, size = width * height, { bins, clip } = geometry;
    let tw = geometry.width ?? width, th = geometry.height ?? height;
    if (geometry.percent) {
        tw = Math.round(width * (geometry.width ?? 100) / 100);
        th = Math.round(height * (geometry.height ?? geometry.width ?? 100) / 100);
    } else if (!geometry.exact) {
        const scale = geometry.width === undefined ? th / height : geometry.height === undefined ? tw / width : Math.min(tw / width, th / height);
        tw = Math.round(width * scale); th = Math.round(height * scale);
    }
    tw = Math.max(2, tw === 0 ? Math.floor(width / 8) : tw);
    th = Math.max(2, th === 0 ? Math.floor(height / 8) : th);
    const columns = Math.ceil(width / tw), rows = Math.ceil(height / th);
    // Bound padded-pixel work and tile storage before allocating or entering loops.
    if (!Number.isSafeInteger(tw * th * columns * rows) || tw * th * columns * rows > 64 * 1024 * 1024 || columns * rows * bins > 16 * 1024 * 1024 || bins < 1)
        throw new Error("CLAHE geometry exceeds pixel or histogram limit");
    const offsetX = Math.floor((columns * tw - width) / 2), offsetY = Math.floor((rows * th - height) / 2);
    const lightness = new Uint16Array(size), tiles = new Uint32Array(columns * rows * bins);
    const delta = Math.floor(65535 / bins + 1), limit = Math.max(1, Math.floor(clip * tw * th / bins));
    for (let start = 0; start < size; start += 512) {
        yield;
        const count = Math.min(512, size - start);
        const bytes = yield { kind: "read", highDepth: true, position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 8) throw new Error("Truncated CLAHE pixels");
        const chunk = { ...image, width: count, height: 1, data: new Uint8Array(count * 4), data16: new Uint16Array(bytes.slice().buffer) };
        const conversion = convertHuePixels(chunk, "CIELab");
        let next = conversion.next();
        while (!next.done) { yield; next = conversion.next(); }
        const lab = next.value;
        for (let i = 0; i < count; i++) lightness[start + i] = lab.data16![i * 4]!;
    }
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 128 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile") ? background : { r: gray, g: gray, b: gray, a: 255 };
    // Constant virtual pixels are already interpreted in the working Lab space.
    const fillLightness = fill.r * 257;
    let work = 0;
    if (clip !== 1) for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < columns; tx++) {
        yield;
        const histogram = tiles.subarray((ty * columns + tx) * bins, (ty * columns + tx + 1) * bins);
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
            if (work++ % 1024 === 0) yield;
            const index = virtualPixelIndex(tx * tw + x - offsetX, ty * th + y - offsetY, width, height, virtualPixel);
            histogram[Math.floor((index < 0 ? fillLightness : lightness[index]!) / delta)]!++;
        }
        let excess = 0;
        for (const count of histogram) excess += Math.max(0, count - limit);
        const step = Math.floor(excess / bins), threshold = limit - step;
        for (let i = 0; i < bins; i++) {
            if (histogram[i]! > limit) histogram[i] = limit;
            else if (histogram[i]! > threshold) { excess -= histogram[i]! - threshold; histogram[i] = limit; }
            else { excess -= step; histogram[i]! += step; }
        }
        let previous;
        do {
            previous = excess;
            const stride = Math.max(1, Math.floor(bins / excess));
            for (let i = 0; excess > 0 && i < bins; i += stride) if (histogram[i]! < limit) { histogram[i]!++; excess--; }
        } while (excess > 0 && excess < previous);
        let sum = 0;
        for (let i = 0; i < bins; i++) {
            sum += histogram[i]!;
            histogram[i] = Math.min(65535, Math.floor(65535 / (tw * th) * sum));
        }
    }
    for (let start = 0; start < size; start += 512) {
        yield;
        const count = Math.min(512, size - start);
        const bytes = yield { kind: "read", highDepth: true, position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 8) throw new Error("Truncated CLAHE pixels");
        const hueBytes = image.magickColorspace === "CIELab"
            ? yield { kind: "read", hue: true, position: start * 4, length: count * 4 } : undefined;
        const data16 = new Uint16Array(bytes.slice().buffer);
        const hueSamples = image.magickColorspace === "CIELab"
            ? hueBytes?.length ? new Float64Array(hueBytes.slice().buffer) : Float64Array.from(data16, value => value / 65535)
            : undefined;
        const conversion = convertHuePixels({ ...image, width: count, height: 1, data: new Uint8Array(count * 4), data16, ...(hueSamples ? { hueSamples } : {}) }, "CIELab");
        let next = conversion.next();
        while (!next.done) { yield; next = conversion.next(); }
        const lab = next.value;
        for (let j = 0; j < lab.hueSamples!.length; j++) lab.hueSamples![j] = Math.fround(lab.hueSamples![j]! * 65535) / 65535;
        for (let i = 0; i < count; i++) {
            let value = lightness[start + i]!;
            if (clip !== 1) {
                const px = (start + i) % width + offsetX, py = Math.floor((start + i) / width) + offsetY;
                const gx = Math.floor((px - Math.floor(tw / 2)) / tw), gy = Math.floor((py - Math.floor(th / 2)) / th);
                const left = Math.max(0, gx), right = Math.min(columns - 1, gx + 1), top = Math.max(0, gy), bottom = Math.min(rows - 1, gy + 1);
                const dx = px - Math.floor(tw / 2) - gx * tw, dy = py - Math.floor(th / 2) - gy * th;
                const bin = Math.floor(value / delta);
                value = Math.floor(((th - dy) * ((tw - dx) * tiles[(top * columns + left) * bins + bin]! + dx * tiles[(top * columns + right) * bins + bin]!)
                    + dy * ((tw - dx) * tiles[(bottom * columns + left) * bins + bin]! + dx * tiles[(bottom * columns + right) * bins + bin]!)) / (tw * th));
            }
            lab.hueSamples![i * 4] = value / 65535;
        }
        if (image.magickColorspace === "CIELab") {
            yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(lab.hueSamples!.buffer) };
            const output = Uint16Array.from(lab.hueSamples!, value => Math.max(0, Math.min(65535, Math.round(value * 65535))));
            yield { kind: "write", highDepth: true, position: start * 4, data: new Uint8Array(output.buffer) };
            continue;
        }
        // Match native float Quantum storage before rounding the final Q16 samples.
        const output = new Uint16Array(count * 4);
        for (let i = 0; i < count; i++) {
            const l = lab.hueSamples![i * 4]!, a = lab.hueSamples![i * 4 + 1]!, b = lab.hueSamples![i * 4 + 2]!;
            const fy = (l * 100 + 16) / 116, fx = (a - 0.5) * 255 / 500 + fy, fz = fy - (b - 0.5) * 255 / 200;
            const inverse = (value: number) => value > 6 / 29 ? value ** 3 : (value - 16 / 116) * 108 / 841;
            const x = 0.95047 * inverse(fx), y = inverse(fy), z = 1.08883 * inverse(fz);
            const linear = [3.24096994190452 * x - 1.53738317757009 * y - 0.498610760293003 * z,
                -0.96924363628088 * x + 1.87596750150772 * y + 0.0415550574071756 * z,
                0.0556300796969937 * x - 0.203976958888977 * y + 1.05697151424288 * z];
            const minimum = Math.min(0, ...linear);
            for (let channel = 0; channel < 3; channel++) {
                const value = linear[channel]! - minimum;
                const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
                output[i * 4 + channel] = Math.max(0, Math.min(65535, Math.round(Math.fround(encoded * 65535))));
            }
            output[i * 4 + 3] = Math.round(lab.hueSamples![i * 4 + 3]! * 65535);
        }
        yield { kind: "write", highDepth: true, position: start * 4, data: new Uint8Array(output.buffer) };
    }
}
