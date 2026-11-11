import type { RgbaImage } from "@poe-code/image-ast/portable";
import type { HueMetadata } from "./colorspace-hue.js";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import createIccRuntime from "./icc/runtime.js";

// One bounded LittleCMS instance per transform; retained images reuse it across chunks.
export function createIccConversion(source: Uint8Array | undefined, destination: Uint8Array | undefined, intent?: string, blackPointCompensation = false) {
    if (!source || !destination || source.length === destination.length && source.every((byte, index) => byte === destination[index])) return;
    const runtime = createIccRuntime();
    let sourceProfile = 0, destinationProfile = 0, transform = 0, input = 0, output = 0;
    const close = () => {
        if (transform) runtime._cmsDeleteTransform(transform);
        if (sourceProfile) runtime._cmsCloseProfile(sourceProfile);
        if (destinationProfile) runtime._cmsCloseProfile(destinationProfile);
        runtime._free(input);
        runtime._free(output);
        sourceProfile = destinationProfile = transform = input = output = 0;
    };
    const allocate = (bytes: number) => {
        const pointer = runtime._malloc(bytes);
        if (!pointer) throw new Error("ICC color conversion memory limit exceeded");
        return pointer;
    };
    const open = (bytes: Uint8Array) => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const fail = (): never => { throw new Error("invalid or unsupported ICC color profile"); };
        if (bytes.length < 132 || view.getUint32(36) !== 0x61637370) fail();
        const size = view.getUint32(0), count = view.getUint32(128);
        if (size < 132 || size > bytes.length || count > (size - 132) / 12) fail();
        for (let index = 0; index < count; index++) {
            const entry = 132 + index * 12, offset = view.getUint32(entry + 4), length = view.getUint32(entry + 8);
            if (offset < 132 + count * 12 || length < 8 || offset + length > size) fail();
        }
        const pointer = allocate(bytes.length);
        try {
            runtime.HEAPU8.set(bytes, pointer);
            const profile = runtime._cmsOpenProfileFromMem(pointer, bytes.length);
            if (!profile) throw new Error("invalid ICC profile");
            return profile;
        } finally { runtime._free(pointer); }
    };
    try {
        sourceProfile = open(source);
        destinationProfile = open(destination);
        const sourceSpace = runtime._cmsGetColorSpace(sourceProfile), destinationSpace = runtime._cmsGetColorSpace(destinationProfile);
        // ICC signatures: RGB, CMYK, GRAY. Alpha is kept outside the transform.
        const channels = new Map([[0x52474220, 3], [0x434d594b, 4], [0x47524159, 1]]);
        const sourceChannels = channels.get(sourceSpace), destinationChannels = channels.get(destinationSpace);
        if (!sourceChannels || !destinationChannels) throw new Error("unsupported ICC colorspace");
        const renderingIntent = ["perceptual", "relative", "saturation", "absolute"].indexOf(intent?.toLowerCase() ?? "perceptual");
        transform = runtime._cmsCreateTransform(sourceProfile, runtime._cmsFormatterForColorspaceOfProfile(sourceProfile, 0, 1),
            destinationProfile, runtime._cmsFormatterForColorspaceOfProfile(destinationProfile, 0, 1), Math.max(0, renderingIntent),
            0x0400 | (blackPointCompensation ? 0x2000 : 0)); // HIGHRESPRECALC | BLACKPOINTCOMPENSATION
        if (!transform) throw new Error("unable to create ICC color transform");
        const chunkPixels = 512;
        input = allocate(chunkPixels * sourceChannels * 8);
        output = allocate(chunkPixels * destinationChannels * 8);
        return {
            close,
            *apply(image: RgbaImage & HueMetadata): Generator<void, RgbaImage & HueMetadata, void> {
                const { hueSamples: ignoredHue, storedHueSamples: ignoredStoredHue, magickColorspace: ignoredSpace,
                    dataFloat: ignoredFloat, ...metadata } = image;
                const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length);
                const evaluateSamples = new Float64Array(data.length);
                const hueSamples = destinationChannels === 4 ? new Float64Array(data.length) : undefined;
                const colors = image.hueSamples ?? image.evaluateSamples ?? image.data16 ?? image.data;
                const range = image.hueSamples ? 1 : image.evaluateSamples ? 255 : image.data16 ? 65535 : 255;
                const alpha = image.evaluateSamples ?? image.data16 ?? image.data;
                const alphaRange = image.evaluateSamples ? 255 : image.data16 ? 65535 : 255;
                for (let start = 0; start < data.length / 4; start += chunkPixels) {
                    yield;
                    const count = Math.min(chunkPixels, data.length / 4 - start);
                    for (let pixel = 0; pixel < count; pixel++) {
                        const offset = (start + pixel) * 4;
                        const inks = sourceChannels === 4 && !image.hueSamples
                            ? rgbToCmyk(colors[offset]! / range, colors[offset + 1]! / range, colors[offset + 2]! / range) : undefined;
                        for (let channel = 0; channel < sourceChannels; channel++) {
                            const sample = inks ? inks[channel]! : colors[offset + channel]! / range;
                            runtime.HEAPF64[input / 8 + pixel * sourceChannels + channel] = sample * (sourceChannels === 4 ? 100 : 1);
                        }
                    }
                    runtime._cmsDoTransform(transform, input, output, count);
                    for (let pixel = 0; pixel < count; pixel++) {
                        const offset = (start + pixel) * 4, result = output / 8 + pixel * destinationChannels;
                        if (hueSamples) for (let channel = 0; channel < 4; channel++) {
                            hueSamples[offset + channel] = Math.fround(runtime.HEAPF64[result + channel]! / 100 * 65535) / 65535;
                        }
                        for (let channel = 0; channel < 4; channel++) {
                            const sample = channel === 3 ? alpha[offset + 3]! / alphaRange
                                : hueSamples ? (1 - hueSamples[offset + channel]!) * (1 - hueSamples[offset + 3]!)
                                : Math.fround(runtime.HEAPF64[result + (destinationChannels === 1 ? 0 : channel)]! * 65535) / 65535;
                            evaluateSamples[offset + channel] = sample * 255;
                            data[offset + channel] = Math.round(Math.max(0, Math.min(1, sample)) * 255);
                            data16[offset + channel] = Math.round(Math.max(0, Math.min(1, sample)) * 65535);
                        }
                    }
                }
                return { ...metadata, data, data16, evaluateSamples, ...(hueSamples ? { hueSamples } : {}),
                    icc: destination, isPalette: false, space: destinationChannels === 4 ? "cmyk" : destinationChannels === 1 ? "b-w" : "srgb",
                    channels: destinationChannels === 4 ? 4 : destinationChannels === 1 ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3 };
            }
        };
    } catch (error) { close(); throw error; }
}
