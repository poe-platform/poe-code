import { ctr } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { ImageMetadata } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** ImageMagick's passkey split, little-endian pixel extent, and row-padded AES-CTR. */
export function* encipherPixelSteps(image: ImageMetadata, passkey: Uint8Array): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const split = Math.floor(passkey.length / 2), keyLength = passkey.length - split;
    const key = new Uint8Array(keyLength >= 32 ? 32 : keyLength >= 24 ? 24 : 16);
    key.set(passkey.subarray(split, split + key.length));
    const extent = new Uint8Array(8);
    new DataView(extent.buffer).setBigUint64(0, BigInt(image.width) * BigInt(image.height), true);
    const counter = sha256.create().update(passkey.subarray(0, split)).update(extent).digest().slice(0, 16);
    const highDepth = image.depth === "ushort", bytesPerSample = highDepth ? 2 : 1;
    const gray = image.space === "b-w", channels = (gray ? 1 : 3) + (image.hasAlpha ? 1 : 0);
    try {
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x += 4096) {
            yield;
            const count = Math.min(4096, image.width - x), position = (y * image.width + x) * 4;
            const bytes = yield { kind: "read", position, length: count * 4, highDepth };
            if (!bytes) throw new Error("Truncated encipher pixels");
            const samples = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
            const packed = new Uint8Array(count * channels * bytesPerSample);
            let offset = 0;
            for (let pixel = 0; pixel < count; pixel++) for (let channel = 0; channel < channels; channel++) {
                const value = samples[pixel * 4 + (channel === channels - 1 && image.hasAlpha ? 3 : channel)]!;
                if (highDepth) packed[offset++] = value >>> 8;
                packed[offset++] = value & 255;
            }
            const encrypted = ctr(key, counter).encrypt(packed);
            // Native discards unused keystream at each row boundary.
            let carry = Math.ceil(packed.length / 16);
            for (let i = 15; i >= 0 && carry; i--) {
                carry += counter[i]!;
                counter[i] = carry & 255;
                carry = Math.floor(carry / 256);
            }
            const output = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
            offset = 0;
            for (let pixel = 0; pixel < count; pixel++) {
                output[pixel * 4 + 3] = highDepth ? 65535 : 255;
                for (let channel = 0; channel < channels; channel++) {
                    const value = highDepth ? encrypted[offset++]! * 256 + encrypted[offset++]! : encrypted[offset++]!;
                    output[pixel * 4 + (channel === channels - 1 && image.hasAlpha ? 3 : channel)] = value;
                }
                if (gray) output[pixel * 4 + 1] = output[pixel * 4 + 2] = output[pixel * 4]!;
            }
            yield { kind: "write", position, data: new Uint8Array(output.buffer), highDepth };
        }
    } finally { key.fill(0); counter.fill(0); }
}
