import { sha256 } from "@noble/hashes/sha2.js";
import type { RgbaImage } from "@poe-code/image-ast/portable";

/** ImageMagick hashes normalized channels as little-endian IEEE float32. */
export function* signatureSteps<Step = never>(
    image: Omit<RgbaImage, "data" | "data16"> & Partial<Pick<RgbaImage, "data" | "data16">>,
    load?: (position: number, length: number) => Generator<Step, { data: Uint8Array; data16?: Uint16Array }, void>
): Generator<Step | undefined, string, void> {
    const hash = sha256.create();
    const gray = image.space === "b-w" || image.space === "grey16";
    const channels = gray ? [0] : [0, 1, 2];
    if (image.hasAlpha) channels.push(3);
    const packed = new Uint8Array(4096 * channels.length * 4);
    const view = new DataView(packed.buffer);
    try {
        for (let position = 0; position < image.width * image.height * 4; position += 16384) {
            yield;
            const length = Math.min(16384, image.width * image.height * 4 - position);
            const chunk = load ? yield* load(position, length) : {
                data: image.data!.subarray(position, position + length),
                data16: image.data16?.subarray(position, position + length)
            };
            const samples = chunk.data16 ?? chunk.data, range = chunk.data16 ? 65535 : 255;
            let offset = 0;
            for (let pixel = 0; pixel < length; pixel += 4) for (const channel of channels) {
                view.setFloat32(offset, samples[pixel + channel]! / range, true);
                offset += 4;
            }
            hash.update(packed.subarray(0, offset));
        }
        return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, "0")).join("");
    } finally {
        hash.destroy();
    }
}
