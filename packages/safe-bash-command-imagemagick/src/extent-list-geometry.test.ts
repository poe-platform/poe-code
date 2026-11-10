import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: raster dimensions and page geometry for each image.
const cases = [
    { geometry: "%[fx:u[0].w+1]x2", expected: "4x2|4x2+0+0;5x2|5x2+0+0;" },
    { geometry: "%[fx:u[1].w]x2", expected: "5x2|5x2+0+0;5x2|5x2+0+0;" },
    { geometry: "%[fx:t+2]x2", expected: "2x2|2x2+0+0;3x2|3x2+0+0;" },
    { geometry: "%[fx:n+2]x2", expected: "4x2|4x2+0+0;4x2|4x2+0+0;" },
    { geometry: "%[fx:w]x%[fx:h]", expected: "3x2|3x2+0+0;5x1|5x1+0+0;" },
    { geometry: "4x3", expected: "4x3|4x3+0+0;4x3|4x3+0+0;" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`expands extent $geometry against the current image list (${mode})`, async ({ geometry, expected }) => {
        const input = Uint8Array.from({ length: 18 }, (_, index) => index + 1);
        const files = new Map([["/in.rgb", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.rgb", input);
        const argv = ["-size", "3x2", "-depth", "8", "rgb:/in.rgb", "-size", "5x1", "xc:red",
            "-extent", geometry, "-format", "%wx%h|%g;", "info:"];
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
