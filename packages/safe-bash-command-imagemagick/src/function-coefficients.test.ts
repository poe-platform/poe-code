import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

it.each([
    ["1-0.25", [0, 0, 32, 64]],
    ["1,-0.25", [0, 0, 32, 64]],
    ["1e-1,0", [3, 6, 10, 13]],
] as const)("matches native signed Polynomial coefficients %s", async (parameters, expected) => {
    const args = createCommandArguments(["xc:#20406080", "-function", "Polynomial", parameters, "-depth", "8", "rgba:-"]);
    const stdout: number[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(stdout).toEqual(expected);
});

for (const mode of ["buffered", "sync", "command"] as const) {
    for (const separator of [",", " ", " , ", "\t"]) {
        it.each([
            { operation: "Polynomial", coefficients: [0.5, 0.2], expected: [64, 101, 161, 255] },
            { operation: "Sinusoid", coefficients: [1, 90, 0.5, 0.5], expected: [232, 28, 210, 255] },
        ])(`matches native $operation coefficients separated by ${JSON.stringify(separator)} via ${mode}`, async ({ operation, coefficients, expected }) => {
            const input = await sharp(Uint8Array.from([25, 100, 220]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
            const argv = ["/input.png", "-function", operation, coefficients.join(separator), "/out.png"];
            const files = new Map([["/input.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/input.png", input);
            if (mode === "command") {
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect(stderr).toBe("");
                expect(result.exitCode).toBe(0);
            } else {
                const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
                expect(result.exitCode).toBe(0);
            }
            const output = mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected);
        });
    }
}
