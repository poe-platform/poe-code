import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded PNG64 RGBA samples in big-endian order.
for (const [operation, geometry, hex] of [
    ["resize", "2x2!", "227229793080ffff4b015208590fffff9ce6a3edaaf4ffffc575cc7cd383ffff"],
    ["scale", "2x2!", "26a72dae34b5ffff50d157d85edfffff97179e1ea525ffffc141c848cf4fffff"],
    ["thumbnail", "2x2!", "2093279a2ea1ffff4a0251095810ffff9de5a4ecabf3ffffc754ce5bd562ffff"],
    ["sample", "2x2!", "000007070e0effff2a2a31313838ffffa8a8afafb6b6ffffd2d2d9d9e0e0ffff"],
    ["scale", "4x3!", "000007070e0effff15151c1c2323ffff2a2a31313838ffff3f3f46464d4dffff54545b5b6262ffff696970707777ffff7e7e85858c8cffff93939a9aa1a1ffffa8a8afafb6b6ffffbdbdc4c4cbcbffffd2d2d9d9e0e0ffffe7e7eeeef5f5ffff"]
] as const) for (const mode of ["command", "buffered", "sync"] as const) {
    it(`${mode}: ${operation} ${geometry} retains fractional samples from an 8-bit source`, async () => {
        const source = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
        const files = new Map<string, Uint8Array>([["in.ppm", source], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", source);
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const argv = ["in.ppm", `-${operation}`, geometry, "PNG64:out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const image = decodeImage(mode === "command" ? await fs.readFile("/out") : files.get("out")!);
        expect([image.width, image.height]).toEqual(geometry === "4x3!" ? [4, 3] : [2, 2]);
        const reference = Buffer.from(hex, "hex");
        expect(Array.from(image.data16 ?? [])).toEqual(Array.from({ length: reference.length / 2 }, (_, i) => reference.readUInt16BE(i * 2)));
    });
}
