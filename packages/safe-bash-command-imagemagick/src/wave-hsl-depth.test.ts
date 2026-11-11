import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, big-endian RGB16 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const format of ["rgb", "PNG48", "PNG64", "tiff"]) {
    it.each([
        ["blend", ".5x1", true, "b9f05c49d927592f6d7781bedf9cb900ec7b"],
        ["bilinear", ".5x1", true, "b9f05c49d927592f6d7781bedf9cb900ec7b"],
        ["blend", "0x1", true, "28fe357141e49909a57cb1ef"],
        ["nearest", ".5x1", true, "28fe357141e49909a57cb1efffffffffffff"],
        ["blend", ".5x1", false, "947f9ab8a0f261046d7779eacc84d2bed8f7"],
        ["bilinear", ".5x1", false, "947f9ab8a0f261046d7779eacc84d2bed8f7"],
    ] as const)(`${mode}/${format}: preserves native wave precision with %s %s HSL=%s`, async (method, geometry, hsl, expected) => {
        const pixels = Buffer.alloc(12);
        [10494, 13681, 16868, 39177, 42364, 45551].forEach((value, index) => pixels.writeUInt16BE(value, index * 2));
        const input = Buffer.concat([Buffer.from("P6\n1 2\n65535\n"), pixels]);
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...(hsl ? ["-colorspace", "HSL"] : []), "-interpolate", method, "-wave", geometry,
            ...(hsl ? ["-colorspace", "sRGB"] : []), "-depth", "16", "-endian", "MSB", `${format}:/out.raw`];
        let stdout = "", stderr = "";
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr,
        } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        if (format === "rgb") expect(Buffer.from(output).toString("hex")).toBe(expected);
        else {
            const image = decodeImage(output), bytes = Buffer.from(expected, "hex");
            expect([image.width, image.height]).toEqual([1, geometry === "0x1" ? 2 : 3]);
            expect(Array.from(image.data16!.filter((_, index) => index % 4 !== 3)))
                .toEqual(Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readUInt16BE(index * 2)));
        }
    });
}
