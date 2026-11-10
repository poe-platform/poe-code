import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [100, 0, 0, 0, 0, 100, 0, 0, 10, 20, 30, 128, 10, 20, 30, 255, 10, 20, 30, 128, 0, 0, 255, 255];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    async function convert(operations: string[], destination = "PNG48:out.png", samples?: number[]) {
        const input = encodeImage({ width: samples ? samples.length / 4 : 6, height: 1,
            data: samples ? Uint8Array.from(samples, value => Math.round(value / 257)) : Uint8Array.from(pixels),
            ...(samples ? { data16: Uint16Array.from(samples) } : {}),
            format: "png", space: "srgb", channels: 4, depth: samples ? "ushort" : "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const argv = ["in.png", "-background", "white", ...operations, destination];
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        if (destination === "info:") return mode === "command" ? stdout : ("stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout);
        return decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
    }

    // Native ImageMagick 7.1.2-35 Q16-HDRI samples and default-precision mean.
    it.each([false, true])(`${mode}: preserves compositing precision with alpha off=%s`, async off => {
        const image = await convert(["-alpha", "remove", ...(off ? ["-alpha", "off"] : [])]);
        if (typeof image === "string") throw new Error("Expected image");
        expect([...image.data16!]).toEqual([
            65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535,
            33929, 35219, 36509, 65535, 2570, 5140, 7710, 65535,
            33929, 35219, 36509, 65535, 0, 0, 65535, 65535
        ]);
    });

    it(`${mode}: keeps the existing PNG24 rounding`, async () => {
        const image = await convert(["-alpha", "remove"], "PNG24:out.png");
        if (typeof image === "string") throw new Error("Expected image");
        expect([...image.data]).toEqual([
            255, 255, 255, 255, 255, 255, 255, 255, 132, 137, 142, 255,
            10, 20, 30, 255, 132, 137, 142, 255, 0, 0, 255, 255
        ]);
    });

    it(`${mode}: uses composited high-depth samples for mean before encoding`, async () => {
        expect(await convert(["-alpha", "remove", "-format", "%[fx:mean]"], "info:")).toBe("0.581097");
    });

    it(`${mode}: alpha off keeps unblended 16-bit source colors`, async () => {
        const image = await convert(["-alpha", "off"], "PNG48:out.png", [17185, 34661, 43981, 39030]);
        if (typeof image === "string") throw new Error("Expected image");
        expect([...image.data16!]).toEqual([17185, 34661, 43981, 65535]);
    });

    it(`${mode}: blends full-depth input colors and alpha`, async () => {
        const image = await convert(["-alpha", "remove"], "PNG48:out.png", [17185, 34661, 43981, 39030]);
        if (typeof image === "string") throw new Error("Expected image");
        expect([...image.data16!]).toEqual([36740, 47148, 52698, 65535]);
    });
}
