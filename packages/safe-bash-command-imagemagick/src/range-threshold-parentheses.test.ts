import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 16-bit MSB gray output for the nine PGM samples.
for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const) {
    it.each([
        ["10x30+60+90%", true],
        ["10,30,60,90%", true],
        ["10/30/60/90%", true],
        ["(10x30+60+90%)", true],
        ["(10,30,60,90)%", true],
        ["()", false],
        ["(bad)", false],
        ["(10,30,60,nope%)", false],
        ["", false],
    ] as const)(`${mode}: range-threshold geometry %j`, async (threshold, valid) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([
            ["/in.pgm", Buffer.concat([Buffer.from("P5\n9 1\n255\n"), Buffer.from([0, 32, 64, 96, 128, 160, 192, 224, 255])])],
            ["/out.gray", original],
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.pgm", "-range-threshold", threshold, "-endian", "MSB", "-depth", "16", "gray:/out.gray"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stderr } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(valid ? 0 : 1);
        expect(result.stderr).toEqual(valid ? "" : expect.stringContaining("invalid argument '-range-threshold'"));
        const output = mode === "sync" || mode === "buffered" ? files.get("/out.gray")! : await fs.readFile("/out.gray");
        expect(Buffer.from(output).toString("hex")).toBe(valid ? "000020a1c141ffffffffe8927d7d12680000" : Buffer.from(original).toString("hex"));
    });
}
