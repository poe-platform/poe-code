import { defaultRuntime } from "@poe-code/compression";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";

// Single-part, uncompressed scanlines with FLOAT channels, in alphabetical order.
function exrHeader(width: number, height: number, alpha: boolean): Uint8Array {
    const bytes: number[] = [0x76, 0x2f, 0x31, 1, 2, 0, 0, 0];
    const text = (value: string) => [...new TextEncoder().encode(value), 0];
    const integers = (...values: number[]) => {
        const data = new Uint8Array(values.length * 4), view = new DataView(data.buffer);
        values.forEach((value, index) => view.setInt32(index * 4, value, true));
        return [...data];
    };
    const attribute = (name: string, type: string, data: number[]) => bytes.push(...text(name), ...text(type), ...integers(data.length), ...data);
    const names = alpha ? ["A", "B", "G", "R"] : ["B", "G", "R"];
    attribute("channels", "chlist", [...names.flatMap(name => [...text(name), ...integers(2, 0, 1, 1)]), 0]);
    attribute("compression", "compression", [0]);
    attribute("dataWindow", "box2i", integers(0, 0, width - 1, height - 1));
    attribute("displayWindow", "box2i", integers(0, 0, width - 1, height - 1));
    attribute("lineOrder", "lineOrder", [0]);
    attribute("pixelAspectRatio", "float", integers(0x3f800000));
    attribute("screenWindowCenter", "v2f", integers(0, 0));
    attribute("screenWindowWidth", "float", integers(0x3f800000));
    bytes.push(0);
    return Uint8Array.from(bytes);
}

function exrSamples(samples: Uint8Array | Uint16Array | Float32Array, channel: number): Uint8Array {
    const data = new Uint8Array(samples.length), view = new DataView(data.buffer);
    const maximum = samples instanceof Float32Array ? 1 : samples instanceof Uint16Array ? 65535 : 255;
    for (let pixel = 0; pixel < samples.length / 4; pixel++) view.setFloat32(pixel * 4, samples[pixel * 4 + channel]! / maximum, true);
    return data;
}

export function encodeExrImage(image: RgbaImage): Uint8Array {
    const header = exrHeader(image.width, image.height, image.hasAlpha);
    const channels = image.hasAlpha ? [3, 2, 1, 0] : [2, 1, 0], rowSize = 8 + image.width * channels.length * 4;
    const data = new Uint8Array(header.length + image.height * (8 + rowSize)), view = new DataView(data.buffer);
    data.set(header);
    const samples = image.dataFloat ?? image.data16 ?? image.data;
    for (let y = 0; y < image.height; y++) {
        const offset = header.length + image.height * 8 + y * rowSize;
        view.setBigUint64(header.length + y * 8, BigInt(offset), true);
        view.setInt32(offset, y, true); view.setUint32(offset + 4, rowSize - 8, true);
        channels.forEach((channel, index) => data.set(exrSamples(samples.subarray(y * image.width * 4, (y + 1) * image.width * 4), channel), offset + 8 + index * image.width * 4));
    }
    return data;
}

export async function* encodeExrFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const header = exrHeader(image.width, image.height, image.hasAlpha);
    yield header;
    const channels = image.hasAlpha ? [3, 2, 1, 0] : [2, 1, 0], rowSize = 8 + image.width * channels.length * 4;
    for (let y = 0; y < image.height; y++) {
        await defaultRuntime.yieldTurn(signal);
        const offset = new Uint8Array(8);
        new DataView(offset.buffer).setBigUint64(0, BigInt(header.length + image.height * 8 + y * rowSize), true);
        yield offset;
    }
    const sampleBytes = image.storedDataFloat ? 4 : image.storedData16 ? 2 : 1;
    const position = image.storedDataFloat?.position ?? image.storedData16?.position ?? image.position;
    for (let y = 0; y < image.height; y++) {
        const row = new Uint8Array(8), view = new DataView(row.buffer);
        view.setInt32(0, y, true); view.setUint32(4, rowSize - 8, true);
        yield row;
        for (const channel of channels) for (let x = 0; x < image.width; x += 512) {
            await defaultRuntime.yieldTurn(signal);
            const length = Math.min(512, image.width - x) * 4 * sampleBytes;
            const bytes = await storage.read(position + (y * image.width + x) * 4 * sampleBytes, length, { signal });
            if (bytes.length !== length) throw new Error("Truncated EXR sample storage");
            yield exrSamples(image.storedDataFloat ? new Float32Array(new Uint8Array(bytes).buffer) : image.storedData16 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes, channel);
        }
    }
}
