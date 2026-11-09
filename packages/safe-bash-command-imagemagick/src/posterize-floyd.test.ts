import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -dither <method> -posterize 3 PNG32:out.png,
// independently decoded with magick out.png -depth 8 rgba:-.
for (const execution of ["command", "buffered", "sync"] as const) {
    it.each([
        [5, 1, "332211ff663322ff995533ffcc7744ffff9955ff", ["-dither", "FloydSteinberg"], "000000ff808000ff800080ffff8000ffff8080ff"],
        [5, 1, "332211ff663322ff995533ffcc7744ffff9955ff", ["-dither", "Riemersma"], "000000ff800000ff808000ffff8080ffff8080ff"],
        [5, 1, "332211ff663322ff995533ffcc7744ffff9955ff", ["-dither", "None"], "000000ff800000ff808000ffff8080ffff8080ff"],
        [5, 1, "332211ff663322ff995533ffcc7744ffff9955ff", ["-dither", "FloydSteinberg", "+dither"], "000000ff800000ff808000ffff8080ffff8080ff"],
        [5, 3, "28323cff4d794fff72c062ff970775ffbc4e88ffe1959bff06dcaeff2b23c1ff506ad4ff75b1e7ff9af8faffbf3f0dffe48620ff09cd33ff2e1446ff", ["-dither", "FloydSteinberg"], "000000ff808080ff80ff80ff800080ffff8080ffff8080ff00ff80ff0000ffff008080ff8080ffff80ffffffff0000ffff8000ff00ff80ff000000ff"],
        [1, 7, "28323cff4d794fff72c062ff970775ffbc4e88ffe1959bff06dcaeff", ["-dither", "FloydSteinberg"], "000000ff808080ff80ff80ff800080ffff8080ffff8080ff00ff80ff"],
        [5, 3, "28323c214d794f5072c0627f970775aebc4e88dde1959b0c06dcae3b2b23c16a506ad49975b1e7c89af8faf7bf3f0d26e486205509cd33842e1446b3", ["-dither", "FloydSteinberg"], "000000000000008000800080ff008080808080ff00000000000000000000ff808080ff8080ffff8080ffffff00000000ff80008000808080000080ff"],
    ] as const)(`${execution}: native posterize %ix%i (case %#)`, async (width, height, pixels, options, expected) => {
        const input = await sharp(Uint8Array.from(Buffer.from(pixels, "hex")), { raw: { width, height, channels: 4 } }).png().toBuffer();
        const fs = new MemoryFileSystem(), files = new Map([["in.png", input]]);
        await fs.writeFile("/in.png", input);
        const args = ["in.png", ...options, "-posterize", "3", "PNG32:out.png"];
        const argumentValues = createCommandArguments(args);
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : execution === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}
