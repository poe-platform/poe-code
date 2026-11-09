import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references: identical intensities encoded as P5/P6.
const cases = [
    { format: "pgm", identical: true, lime: false, changed: [212, 212, 212] },
    { format: "pgm", identical: false, lime: false, changed: [32, 32, 32] },
    { format: "ppm", identical: false, lime: false, changed: [201, 8, 32] },
    { format: "pgm", identical: false, lime: true, changed: [0, 0, 0] },
    { format: "ppm", identical: false, lime: true, changed: [0, 255, 0] },
];

for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    for (const { format, identical, lime, changed } of cases) {
        it(`preserves ${format} compare colors: ${mode}, identical=${identical}, lime=${lime}`, async () => {
            const inputs = [40, identical ? 40 : 200].map(value => Uint8Array.from([
                ...new TextEncoder().encode(`P${format === "pgm" ? 5 : 6}\n4 2\n255\n`),
                ...[10, 20, 30, value, 50, 60, 70, 80].flatMap(pixel => format === "pgm" ? [pixel] : [pixel, pixel, pixel]),
            ]));
            const files = new Map([[`a.${format}`, inputs[0]!], [`b.${format}`, inputs[1]!]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const argv = ["-metric", "RMSE", ...(lime ? ["-highlight-color", "lime"] : []), `a.${format}`, `b.${format}`, "diff.ppm"];
            let result;
            if (mode === "compare" || mode === "magick") {
                const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
                const args = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
                let stdout = "", stderr = "";
                const status = await command.execute({ command: command.name, args: args.args, argumentValues: args,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                });
                result = { ...status, stdout, stderr };
            } else {
                result = mode === "sync" ? runCompareCliSync(argv, files)
                    : await runCompareCli(argv, mode === "memory" ? files : { filesystem, cwd: "/" });
            }
            expect(result).toEqual({ exitCode: identical ? 0 : 1, stdout: "", stderr: identical ? "0 (0)" : "14538.1 (0.221837)" });
            const read = (name: string) => mode === "sync" || mode === "memory" ? files.get(name)! : filesystem.readFile(`/${name}`);
            const image = decodeImage(await read("diff.ppm"));
            expect([image.width, image.height]).toEqual([4, 2]);
            expect([...image.data]).toEqual([206, 208, 210, 212, 214, 216, 218, 220]
                .flatMap((value, index) => [...(index === 3 ? changed : [value, value, value]), 255]));
            expect(await read(`a.${format}`)).toEqual(inputs[0]);
            expect(await read(`b.${format}`)).toEqual(inputs[1]);
        });
    }
}

for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    it(`preserves default 16-bit grayscale comparison samples: ${mode}`, async () => {
        // Native Q16-HDRI output retains low bits: 52628, 54067, 58428, 60872, 63428, 64716.
        const input = Uint8Array.from(Buffer.from("50350a3320320a36353533350a03e820017531a4eed6d8f002", "hex"));
        const expected = Uint8Array.from(Buffer.from("50350a3320320a36353533350acd94d333e43cedc8f7c4fccc", "hex"));
        const files = new Map([["hi.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/hi.pgm", input);
        const argv = ["-metric", "RMSE", "hi.pgm", "hi.pgm", "diff.pgm"];
        let result;
        if (mode === "compare" || mode === "magick") {
            const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
            const args = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
            let stdout = "", stderr = "";
            const status = await command.execute({ command: command.name, args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            result = { ...status, stdout, stderr };
        } else {
            result = mode === "sync" ? runCompareCliSync(argv, files)
                : await runCompareCli(argv, mode === "memory" ? files : { filesystem, cwd: "/" });
        }
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
        expect(mode === "sync" || mode === "memory" ? files.get("diff.pgm") : await filesystem.readFile("/diff.pgm")).toEqual(expected);
        expect(mode === "sync" || mode === "memory" ? files.get("hi.pgm") : await filesystem.readFile("/hi.pgm")).toEqual(input);
    });
}
