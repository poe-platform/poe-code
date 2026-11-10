import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [0, 40, 90, 0, 80, 100, 150, 128, 200, 50, 70, 255];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    // Native ImageMagick 7.1.2-35 Q16-HDRI raw bytes, including controls.
    it.each([
        ["#9aba66b4", "Disassociate", "8", "daff91ff"],
        ["#9aba66b4", "Disassociate", "16", "db05ffff9111ffff"],
        ["#9aba66b4", "On", "16", "9a9ababa6666b4b4"],
        ["#80402060", "Disassociate", "16", "ffffaaaa5555ffff"],
    ])(`${execution}: exports %s alpha %s at depth %s`, async (color, mode, depth, hex) => {
        const argv = [`xc:${color}`, "-alpha", mode, "-depth", depth, "-endian", "MSB", "rgba:out"];
        const keep = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
        const files = new Map([["out", keep]]);
        await fs.writeFile("/out", keep);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : execution === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = execution === "command" || execution === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });

    async function convert(mode: string, format: string, samples?: number[], operators: string[] = []) {
        const data = Uint8Array.from(samples ?? pixels, value => samples ? Math.round(value / 257) : value);
        const input = encodeImage({ width: data.length / 4, height: 1, data,
            ...(samples ? { data16: Uint16Array.from(samples) } : {}),
            format: "png", space: "srgb", channels: 4, depth: samples ? "ushort" : "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const argv = ["in.png", "-background", "#123456", "-alpha", mode, ...operators, `${format}:out.png`];
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : execution === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        return decodeImage(execution === "command" || execution === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
    }

    it.each(["off", "opaque", "transparent"])(`${execution}: alpha %s preserves distinct 16-bit RGB`, async mode => {
        const samples = [10000, 20000, 30000, 12345, 10000, 20000, 30001, 23456, 60000, 65000, 64000, 65535];
        const expected = samples.map((sample, index) => index % 4 === 3 ? mode === "transparent" ? 0 : 65535 : sample);
        expect([...(await convert(mode, "PNG64", samples)).data16!]).toEqual(expected);
        const palette = await convert(mode, "PNG64", samples, ["-unique-colors"]);
        expect(palette.width).toBe(3);
        expect([...palette.data16!]).toEqual(expected);
    });

    // Decoded samples from native ImageMagick 7.1.2-35 Q16-HDRI.
    it.each([
        ["associate", [10320, 12900, 19351]],
        ["disassociate", [40959, 51199, 65535]]
    ] as const)(`${execution}: preserves %s RGB precision in PNG48`, async (mode, expected) => {
        const image = await convert(mode, "PNG48");
        expect([...image.data16!.subarray(4, 8)]).toEqual([...expected, 65535]);
        expect([...image.data16!.subarray(8)]).toEqual([51400, 12850, 17990, 65535]);
        expect(image.hasAlpha).toBe(false);
    });

    it.each([
        ["associate", [0, 0, 0, 255, 40, 50, 75, 255, 200, 50, 70, 255]],
        ["disassociate", [0, 255, 255, 255, 159, 199, 255, 255, 200, 50, 70, 255]]
    ] as const)(`${execution}: keeps %s PNG32 results`, async (mode, expected) => {
        expect([...(await convert(mode, "PNG32")).data]).toEqual(expected);
    });

    it(`${execution}: alpha off preserves source RGB in PNG48`, async () => {
        expect([...(await convert("off", "PNG48")).data16!]).toEqual([
            0, 10280, 23130, 65535, 20560, 25700, 38550, 65535, 51400, 12850, 17990, 65535
        ]);
    });

    it.each([
        ["associate", [4115, 7819, 11523, 65535]],
        ["disassociate", [37035, 65535, 65535, 65535]]
    ] as const)(`${execution}: uses full-depth input RGB and alpha for %s`, async (mode, expected) => {
        expect([...(await convert(mode, "PNG48", [12345, 23457, 34569, 21845])).data16!]).toEqual(expected);
    });
}
