import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a single selected channel is Gray and retains alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "sRGB", expression: "r", output: "info", after: [], expected: "Gray|graya 2.0|Grayscale" },
        { space: "RGB", expression: "alpha", output: "info", after: [], expected: "Gray|graya 2.0|Grayscale" },
        { space: "RGB", expression: "alpha", output: "rgba", after: ["-colorspace", "sRGB"], expected: "c0c0c0c0" },
        { space: "HSL", expression: "r", output: "rgba", after: ["-colorspace", "sRGB"], expected: "9c9c9cc0" },
        { space: "sRGB", expression: "g,r", output: "info", after: [], expected: "sRGB|srgba 4.0|PaletteAlpha" },
        { space: "sRGB", expression: "r", output: "rgba", after: [], expected: "202020c0" },
    ])(`${mode}: selects $space $expression into $output, after=$after`, async ({ space, expression, output, after, expected }) => {
        const argv = ["xc:#204080c0", "-colorspace", space, "-channel-fx", expression, ...after,
            ...(output === "info" ? ["-format", "%[colorspace]|%[channels]|%[type]"] : ["-depth", "8"]), `${output}:-`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        let bytes: Buffer;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(bytes.toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
