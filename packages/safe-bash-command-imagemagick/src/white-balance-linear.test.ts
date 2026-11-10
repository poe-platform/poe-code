import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PNG64 output decoded with -endian LSB -depth 16 rgba:-.
const balanced = "61b93474bb39ffff8f94b493c279ffff3b173431f152ffff210b9e209b31ffff";
const cases = [
    { operations: ["-colorspace", "RGB", "-white-balance"], rgba: balanced },
    { operations: ["-colorspace", "RGB", "-colorspace", "Lab", "-white-balance"], rgba: balanced },
    { operations: ["-colorspace", "RGB", "-colorspace", "CIELab", "-white-balance"], rgba: balanced },
    { operations: ["-white-balance"], rgba: balanced },
    { operations: ["-colorspace", "RGB", "-colorspace", "sRGB"], rgba: "c0c070703030ffffa0a090907070ffff202030305050ffff101020203030ffff" }
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const rows of [1, 129]) {
        it.each(cases)(`preserves 16-bit white balance: $operations via ${mode}, ${rows} rows`, async ({ operations, rgba }) => {
            const input = await sharp(Buffer.from("c07030a09070203050102030".repeat(rows), "hex"), {
                raw: { width: 4, height: rows, channels: 3 }
            }).png().toBuffer();
            const files = new Map<string, Uint8Array>([["input.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/input.png", input);
            const filesystem = new Proxy(fs, { get(target, key) {
                if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file white balance forbidden"); };
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            } });
            const args = ["input.png", ...operations, "PNG64:output.png"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/output.png") : files.get("output.png")!);
            const expected = Buffer.from(rgba.repeat(rows), "hex");
            expect([output.width, output.height]).toEqual([4, rows]);
            expect(output.data16).toEqual(Uint16Array.from({ length: expected.length / 2 }, (_, index) => expected.readUInt16LE(index * 2)));
        });
    }
}
