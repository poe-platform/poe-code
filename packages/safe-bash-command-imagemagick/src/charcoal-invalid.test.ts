import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 5x4 RGB8 input.
const pixels = Uint8Array.from({ length: 5 * 4 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 256);
const input = encodeImage({ width: 5, height: 4, data: pixels, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png", pngCoder: "png24" }).data;
const original = new TextEncoder().encode("KEEP");

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["bad", undefined],
        ["1xq", undefined],
        ["", undefined],
        ["0x1junk", undefined],
        ["2x2;", undefined],
        ["0x1", "d0c30f6b7c9e78be8a19920616891a44ac0bc3441282b52843a5907aa771bf21"],
        ["1x1", "9560cf5fde0a9e6b705a9ac3599ec8ceaa3a49cdfcf3c9be2077172a89de9915"],
    ] as const)(`${mode}: validates charcoal geometry %j before replacing output`, async (geometry, expectedHash) => {
        const files = new Map([["/in.png", input], ["/out.png", original]]), fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const args = ["/in.png", "-charcoal", geometry, "PNG32:/out.png"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        expect.soft(result.stdout).toBe("");
        if (expectedHash) {
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([5, 4]);
            expect(createHash("sha256").update(image.data).digest("hex")).toBe(expectedHash);
        } else {
            expect.soft(result.exitCode).toBe(1);
            expect.soft(result.stderr).toContain("invalid argument for option '-charcoal'");
            expect(output).toEqual(original);
        }
    });
}
