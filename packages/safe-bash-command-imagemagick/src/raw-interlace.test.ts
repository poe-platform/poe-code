import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// RGB8 observations from native ImageMagick 7.1.2-35 Q16-HDRI.
const packed = "01080f161d242b323940474e555c636a71787f868d949ba2a9b0b7bec5ccd3dae1e8eff6";
const plane = "0155a9085cb00f63b7166abe1d71c52478cc2b7fd33286da398de14094e8479bef4ea2f6";
const line = "01162b081d320f243940556a475c714e63787f94a9869bb08da2b7bed3e8c5daefcce1f6";

for (const mode of ["file", "stream", "sync"] as const) {
    it.each([
        { options: [], expected: packed },
        { options: ["-interlace", "None"], expected: packed },
        { options: ["-interlace", "Plane"], expected: plane },
        { options: ["-interlace", "Line"], expected: line },
        { options: ["-interlace", "pLaNe"], expected: plane },
        { options: ["-interlace", "Plane", "+interlace"], expected: packed },
        { options: ["-interlace", "Line", "-interlace", "None"], expected: packed }
    ])(`reads RGB in the requested order (${mode}, $options)`, async ({ options, expected }) => {
        const input = Uint8Array.from({ length: 36 }, (_, index) => 7 * index + 1);
        const output = await convert(mode, input, ["-size", "3x4", "-depth", "8", ...options]);
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([3, 4]);
        expect(Buffer.from(image.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(expected);
    });

    // Native ImageMagick 7.1.2-35 Q16-HDRI, identical bytes for each layout.
    it.each([
        [4, "None", "1f364d647b92", "11ff33ff6644ddff664477ffbb9922ff"],
        [4, "Line", "1f364d647b92", "113344ffff66ddff667799ff44bb22ff"],
        [4, "Plane", "1f364d647b92", "114477ffffddbbff336699ff664422ff"],
        [8, "Line", "1f364d647b92a9c0d7ee051c", "1f4d7bff366492ffa9d705ffc0ee1cff"],
        [8, "Plane", "1f364d647b92a9c0d7ee051c", "1f7bd7ff3692eeff4da905ff64c01cff"]
    ] as const)(`reads RGB%d %s samples (${mode})`, async (depth, interlace, hex, expected) => {
        const output = await convert(mode, Buffer.from(hex, "hex"), ["-size", "2x2", "-depth", String(depth), "-interlace", interlace]);
        expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(expected);
    });

    it.each(["Plane", "Line"])(`reads RGB16 across rows and bounded reads (${mode}, %s)`, async interlace => {
        const width = 3001, height = 2, input = new Uint8Array(width * height * 6);
        const view = new DataView(input.buffer), expected: number[] = [];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < 3; channel++) {
                const value = ((y * width + x) * 17 + channel * 10007) & 65535;
                const sample = interlace === "Plane" ? channel * width * height + y * width + x : (y * 3 + channel) * width + x;
                view.setUint16(sample * 2, value, true);
                expected.push(value);
            }
            expected.push(65535);
        }
        const output = await convert(mode, input, ["-size", `${width}x${height}`, "-depth", "16", "-endian", "LSB", "-interlace", interlace]);
        expect(Array.from(decodeImage(output).data16!)).toEqual(expected);
    });

    for (const [interlace, expected] of [["Plane", plane], ["Line", line]] as const) {
        it.each(["MSB", "LSB"])(`preserves RGB16 samples (${mode}, ${interlace}, %s)`, async endian => {
            const input = Buffer.from(Array.from({ length: 36 }, (_, index) => [7 * index + 1, 254 - 7 * index]).flat());
            if (endian === "LSB") input.swap16();
            const output = await convert(mode, input, ["-size", "3x4", "-depth", "16", "-endian", endian, "-interlace", interlace]);
            const image = decodeImage(output);
            expect(Array.from(image.data16!.filter((_, index) => index % 4 !== 3)))
                .toEqual(Array.from(Buffer.from(expected, "hex"), value => value * 256 + 255 - value));
        });
    }
}

async function convert(mode: "file" | "stream" | "sync", input: Uint8Array, options: string[]): Promise<Uint8Array> {
    const argv = [...options, mode === "stream" ? "rgb:-" : "rgb:in.dat", "-interlace", "None", "out.png"];
    const keep = new TextEncoder().encode("KEEP");
    if (mode === "sync") {
        const files = new Map([["in.dat", input], ["out.png", keep]]);
        expect(runMagickCliSync(argv, files)).toMatchObject({ exitCode: 0, stderr: "" });
        return files.get("out.png")!;
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.dat", input);
    await fs.writeFile("/out.png", keep);
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { for (let offset = 0; offset < input.length; offset += 7) yield input.subarray(offset, offset + 7); })(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    return fs.readFile("/out.png");
}
