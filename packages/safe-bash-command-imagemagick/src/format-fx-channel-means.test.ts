import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { options: [], expected: "0.431373|0.490196|0.54902" },
        { options: ["-channel", "R"], expected: "0.431373|0|0" },
        { options: ["-channel", "G"], expected: "0|0.490196|0" },
        { options: ["-channel", "G", "+channel"], expected: "0.431373|0.490196|0.54902" },
    ])(`${mode}: formats FX channel means with $options`, async ({ options, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
        const input = new TextEncoder().encode("P3\n3 2\n255\n10 25 40 50 65 80 90 105 120\n130 145 160 170 185 200 210 225 240\n");
        const files = new Map([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "-format", "%[fx:mean.r]|%[fx:mean.g]|%[fx:mean.b]", "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stdout" in result ? result : { ...result, stdout, stderr })
            .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
