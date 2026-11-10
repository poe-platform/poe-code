import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded as 8-bit RGBA.
const cases = [
    { name: "none", operations: ["-negate"], expected: "00ffffff ff00ffff ffff00ff 0000ffff" },
    { name: "direct", operations: ["-write-mask", "/mask.png", "-negate", "+write-mask"], expected: "ff0000ff ff00ffff ffff00ff 0000ffff" },
    { name: "clear", operations: ["-write-mask", "/mask.png", "+write-mask", "-negate"], expected: "00ffffff ff00ffff ffff00ff 0000ffff" },
    { name: "flopOnly", operations: ["-write-mask", "/mask.png", "-flop", "+write-mask"], expected: "ffff00ff 0000ffff 00ff00ff ff0000ff" },
    { name: "flop", operations: ["-write-mask", "/mask.png", "-flop", "-negate", "+write-mask"], expected: "0000ffff ffff00ff ff00ffff ff0000ff" },
    { name: "flopClear", operations: ["-write-mask", "/mask.png", "-flop", "+write-mask", "-negate"], expected: "0000ffff ffff00ff ff00ffff 00ffffff" },
    { name: "cropOnly", operations: ["-write-mask", "/mask.png", "-crop", "2x1+1+0", "+repage", "+write-mask"], expected: "00ff00ff 0000ffff" },
    { name: "crop", operations: ["-write-mask", "/mask.png", "-crop", "2x1+1+0", "+repage", "-negate", "+write-mask"], expected: "ff00ffff ffff00ff" },
    { name: "rollOnly", operations: ["-write-mask", "/mask.png", "-roll", "+1+0", "+write-mask"], expected: "ff0000ff ff0000ff 00ff00ff 0000ffff" },
    { name: "roll", operations: ["-write-mask", "/mask.png", "-roll", "+1+0", "-negate", "+write-mask"], expected: "00ffffff ff0000ff ff00ffff ffff00ff" },
    { name: "smallMaskFlop", mask: [255, 0], operations: ["-write-mask", "/mask.png", "-flop", "-negate", "+write-mask"], expected: "0000ffff ffff00ff ff00ffff ff0000ff" },
    { name: "smallMaskCrop", mask: [255, 0], operations: ["-write-mask", "/mask.png", "-crop", "2x1+1+0", "+repage", "-negate", "+write-mask"], expected: "ff00ffff ffff00ff" },
    { name: "solidMaskCrop", mask: [255], operations: ["-write-mask", "/mask.png", "-crop", "2x1+1+0", "+repage", "-negate", "+write-mask"], expected: "ff00ffff ffff00ff" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases.map(row => ({ mask: [255, 0, 0, 0], ...row })))(`keeps write-mask geometry aligned in ${mode}: $name`, async ({ operations, expected, mask: maskPixels }) => {
        const input = await sharp(Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]), { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer();
        const mask = await sharp(Uint8Array.from(maskPixels.flatMap(value => [value, value, value])), { raw: { width: maskPixels.length, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input], ["/mask.png", mask]]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/input.png", ...operations, "PNG32:/out.png"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            expect(await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            })).toMatchObject({ exitCode: 0 });
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(expected.split(" ").join(""));
    });
}
