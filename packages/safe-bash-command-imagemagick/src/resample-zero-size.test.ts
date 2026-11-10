import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects axes that round below one pixel.
const cases = [
    { density: "17", output: "KEEP", exitCode: 1 },
    { density: "1", output: "KEEP", exitCode: 1 },
    { density: "x36", output: "KEEP", exitCode: 1 },
    { density: "0x72", output: "KEEP", exitCode: 1 },
    { density: "11x72", output: "KEEP", exitCode: 1 },
    { density: "72x17", output: "KEEP", exitCode: 1 },
    { density: "18", output: "1x1,18,18", exitCode: 0 },
    { density: "36x", output: "2x1,36,36", exitCode: 0 },
    { density: "12x72", output: "1x2,12,72", exitCode: 0 },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`handles -resample $density without clamping zero-sized axes (${mode})`, async ({ density, output, exitCode }) => {
        const input = Buffer.concat([
            Buffer.from("P6\n3 2\n255\n"),
            Buffer.from("ff000000ff000000ffffee00991177245384", "hex"),
        ]);
        const files = new Map([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/im.ppm", "-filter", "point", "-resample", density, "-format", "%wx%h,%x,%y", "info:/out"];
        let result;
        if (mode === "command") {
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const status = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);

        expect(result.exitCode).toBe(exitCode);
        expect(result.stdout).toBe("");
        if (exitCode) expect(result.stderr).toContain(density === "0x72" ? "invalid argument" : "negative or zero image size");
        else expect(result.stderr).toBe("");
        const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(new TextDecoder().decode(actual)).toBe(output);
    });
}
