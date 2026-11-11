import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: extraction uses the destination's red sample
// outside the second source, marks the entire image Gray, and retains its alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each([
            { expression: "|red", size: "1x1", expected: "ababab7812121278", gray: true },
            { expression: "|green", size: "1x1", expected: "7676767812121278", gray: true },
            { expression: "|blue", size: "1x1", expected: "5454547812121278", gray: true },
            { expression: "|alpha", size: "1x1", expected: "3232327812121278", gray: true },
            { expression: "|green", size: "2x1", expected: "7676767876767678", gray: true },
            { expression: "|green", size: "512x1", canvas: "513x2", expected: "76767678".repeat(512) + "12121278".repeat(514), gray: true },
            { expression: "|red=>blue", size: "1x1", expected: "1234ab7812345678", gray: false },
            { expression: "green", size: "1x1", expected: "3434347834343478", gray: true },
        ])(`${mode}, ${depth}-bit: $expression from $size`, async ({ expression, size, canvas = "2x1", expected, gray }) => {
            for (const output of ["rgba", "info"]) {
                const argv = ["-size", canvas, "xc:#12345678", "-size", size, "xc:#ab765432", "-channel-fx", expression,
                    "-depth", String(depth), "-endian", "MSB", "-format", "%[colorspace]|%[channels]", `${output}:-`];
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
                const pixels = depth === 8 ? expected : Array.from(Buffer.from(expected, "hex"), value => value.toString(16).padStart(2, "0").repeat(2)).join("");
                expect(bytes.toString(output === "info" ? "utf8" : "hex")).toBe(output === "info" ? gray ? "Gray|graya 2.0" : "sRGB|srgba 4.0" : pixels);
            }
        });
    }
}
