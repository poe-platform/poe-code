import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCli, runMagickCliSync } from "./index.js";

for (const retained of [false, true]) for (const explicitEdges of [false, true]) {
    it.each([
        [undefined, 7],
        ["50%", 4],
        ["80%", 7],
        ["50", 4],
        ["reset", 7],
    ] as const)(`trims speck with background %s (retained=${retained}, explicitEdges=${explicitEdges})`, async (percent, width) => {
        const left = 2, top = 1, height = 4;
        const pixels = new Uint8Array(9 * 7 * 4).fill(255);
        for (let y = 1; y <= 4; y++) for (let x = 2; x <= 5; x++) pixels.set([255, 0, 0, 255], (y * 9 + x) * 4);
        pixels.set([0, 0, 0, 255], (3 * 9 + 8) * 4);
        const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        const args = percent === undefined ? [] : percent === "reset" ? ["-define", "trim:percent-background=50%", "+define", "trim:percent-background"] : ["-define", `trim:percent-background=${percent}`];
        if (explicitEdges) args.push("-define", "trim:edges=north,east,south,west");
        expect((await runConvertCli(["input.png", ...args, "-trim", "out.png"], backend)).exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        const expected = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) expected.set(pixels.subarray(((y + top) * 9 + left) * 4, ((y + top) * 9 + left + width) * 4), y * width * 4);
        expect(output.data).toEqual(expected);
        expect((await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "out.png"], backend)).stdout).toBe(`${width}x${height} +${left} +${top} 9x7`);
    });
}

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const setting of ["define", "option", "artifact"] as const) {
        it.each([
            ["0x50", "4x3 6x5+1+1"],
            ["0X50", "4x3 6x5+1+1"],
            ["+0x50", "4x3 6x5+1+1"],
            [" 0x50%", "4x3 6x5+1+1"],
            ["0x50tail", "4x3 6x5+1+1"],
            ["0x4f.f", "4x3 6x5+1+1"],
            ["0x5p4", "4x2 6x5+1+2"],
            ["-0x50", "4x2 6x5+1+2"],
            ["80", "4x3 6x5+1+1"],
            ["80%", "4x3 6x5+1+1"],
            ["0", "4x2 6x5+1+2"],
            ["invalid", "4x2 6x5+1+2"],
        ])(`parses trim percentage %s (${mode}, ${setting})`, async (value, geometry) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "6x5", "xc:white", "-fill", "black", "-draw", "rectangle 1,2 4,3 point 4,1",
                ...(setting === "define" ? ["-define", `trim:percent-background=${value}`]
                    : ["-set", `${setting}:trim:percent-background`, value]),
                "-trim", "-format", "%wx%h %g", "info:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            // Native ImageMagick 7.1.2-35 reads hexadecimal prefixes as integers, including before a dot or p.
            expect(new TextDecoder().decode(output)).toBe(geometry);
        });
    }
}
