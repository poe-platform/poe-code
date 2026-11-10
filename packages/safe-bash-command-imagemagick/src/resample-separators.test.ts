import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"),
    Buffer.from("ff000000ff000000ffffee00991177245384", "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI: separators preserve both resolution axes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["144/72", "6x2,144,72"],
        ["72,144", "3x4,72,144"],
        ["144,72", "6x2,144,72"],
        ["72/144", "3x4,72,144"],
        ["144x72", "6x2,144,72"],
        ["72x144", "3x4,72,144"],
    ])(`resamples both axes for %s (${mode})`, async (resolution, expected) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/im.ppm", input);
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const files = new Map([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const args = ["/im.ppm", "-filter", "point", "-resample", resolution, "-format", "%wx%h,%x,%y", "info:/out"];
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
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
