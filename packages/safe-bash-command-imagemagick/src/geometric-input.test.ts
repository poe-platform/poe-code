import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const transforms = [
    { args: ["-roll", "+1+1"], width: 4, height: 3, order: [11, 8, 9, 10, 3, 0, 1, 2, 7, 4, 5, 6] },
    { args: ["-flip"], width: 4, height: 3, order: [8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3] },
    { args: ["-flop"], width: 4, height: 3, order: [3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8] },
    { args: ["-transpose"], width: 3, height: 4, order: [0, 4, 8, 1, 5, 9, 2, 6, 10, 3, 7, 11] },
    { args: ["-transverse"], width: 3, height: 4, order: [11, 7, 3, 10, 6, 2, 9, 5, 1, 8, 4, 0] },
    { args: ["-rotate", "90"], width: 3, height: 4, order: [8, 4, 0, 9, 5, 1, 10, 6, 2, 11, 7, 3] },
    { args: ["-chop", "1x0"], width: 3, height: 3, order: [1, 2, 3, 5, 6, 7, 9, 10, 11] },
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const placement of ["before input", "after delete", "after input"] as const) {
        it.each(transforms)(`handles $args ${placement} (${mode})`, async ({ args: operation, width, height, order }) => {
            const pixels = Array.from({ length: 12 }, (_, i) => [i * 20, 255 - i * 15, i * 7, 255]);
            const input = await sharp(Uint8Array.from(pixels.flat()), { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["in.png", input], ["out.png", original]]), fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
            const args = placement === "after input" ? ["in.png", ...operation, "out.png"]
                : [...(placement === "after delete" ? ["in.png", "+delete"] : []), ...operation, "in.png", "out.png"];
            let stdout = "", stderr = "";
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "buffered" || mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png");
            expect.soft(result.stdout).toBe("");
            if (placement === "after input") {
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stderr).toBe("");
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([width, height]);
                expect([...image.data]).toEqual(order.flatMap(i => pixels[i]!));
            } else {
                expect.soft(result.exitCode).toBe(1);
                expect.soft(result.stderr).toContain(`no images found for operation '${operation[0]}'`);
                expect.soft(output).toEqual(original);
            }
        });
    }
}
