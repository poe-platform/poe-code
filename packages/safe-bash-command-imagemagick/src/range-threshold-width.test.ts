import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P5\n9 1\n255\n"), Buffer.from([0, 32, 64, 96, 128, 160, 192, 224, 255])]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    async function run(operands: string[]) {
        const files = new Map<string, Uint8Array>([["/in.pgm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pgm", input);
        const argv = [...operands, "-endian", "MSB", "-depth", "16", "gray:/out.gray"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        return mode === "command" || mode === "retained" ? await fs.readFile("/out.gray") : files.get("/out.gray")!;
    }

    it.each(["%w", "%[fx:w]", "9"])(`${mode}: range threshold %s matches native 16-bit pixels`, async width => {
        const output = await run(["/in.pgm", "-range-threshold", `${width}x30+60+90%`]);
        // ImageMagick 7.1.2-35 Q16-HDRI, with the same PGM bytes and arguments.
        expect(Buffer.from(output).toString("hex")).toBe("00002b43c43dffffffffe8927d7d12680000");
    });

    it(`${mode}: range threshold uses the width after cropping`, async () => {
        const before = ["/in.pgm", "-crop", "4x1+0+0", "+repage", "-range-threshold"];
        expect(await run([...before, "%wx30+60+90%"]))
            .toEqual(await run([...before, "4x30+60+90%"]));
    });

    it(`${mode}: range threshold expands the width of each image`, async () => {
        const output = await run([
            "/in.pgm", "(", "/in.pgm", "-crop", "4x1+0+0", "+repage", ")",
            "-range-threshold", "%wx30+60+90%", "+append",
        ]);
        const expected = await run([
            "(", "/in.pgm", "-range-threshold", "9x30+60+90%", ")",
            "(", "/in.pgm", "-crop", "4x1+0+0", "+repage", "-range-threshold", "4x30+60+90%", ")", "+append",
        ]);
        expect(output).toEqual(expected);
    });
}
