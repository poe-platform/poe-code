import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operator of ["-sigmoidal-contrast", "+sigmoidal-contrast"]) {
        it.each(operator === "-sigmoidal-contrast" ? ["6:25%", "0.24x1%", "6x25%"] : ["6:25%", "0.24x1%"])(`${mode}: matches native ${operator} %s`, async geometry => {
            // ImageMagick 7.1.2-35 Q16-HDRI: colon normalizes 6:25 to 0.24x1;
            // an x separates strength and midpoint without dividing them.
            const samples = [0, 16384, 32768, 49151, 65535].flatMap(value => [value, value, value, 65535]);
            const input = encodeImage({ width: 5, height: 1, format: "png", space: "srgb", channels: 3,
                density: 72, hasAlpha: false, depth: "ushort", data16: Uint16Array.from(samples),
                data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
            const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["/in.png", operator, geometry, "PNG48:/out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
                argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
                : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
            expect(output.depth).toBe("ushort");
            const red = Array.from(output.data16!).filter((_, index) => index % 4 === 0);
            if (geometry === "6:25%" || geometry === "0.24x1%") {
                expect(red).toEqual(operator === "-sigmoidal-contrast"
                    ? [0, 16456, 32883, 49252, 65535] : [0, 16312, 32653, 49050, 65535]);
            } else {
                expect(red[1]).toBe(25803);
            }
        });
    }
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["-sigmoidal-contrast", "5:0", "ffffffffffffffffff"],
        ["+sigmoidal-contrast", "5:0%", "030303030303030303"],
        ["-sigmoidal-contrast", "5:-2%", "27ace72ceafdf8fa95"],
        ["+sigmoidal-contrast", "5:+2%", "ffffffffffffffffff"],
        ["-sigmoidal-contrast", "0:5", "0f50911198e7c3d041"],
        ["+sigmoidal-contrast", "5:2%", "0a386c0c72d09eae2d"]
    ])(`${mode}: matches native %s %s with an existing output`, async (operator, geometry, expected) => {
        // ImageMagick 7.1.2-35 Q16-HDRI: a.ppm [operator] [geometry] -depth 8 rgb:out.
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", original]]), fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", original);
        const argv = ["/a.ppm", operator, geometry, "-depth", "8", "rgb:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
            argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
