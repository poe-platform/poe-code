import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 without FFTW warns and retains the original image.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    for (const option of ["-fft", "+fft"]) {
        it.each([["rgb:-", false], ["/out.miff", false], ["rgb:-", true]] as const)(`continues without FFTW for ${option} (${mode}, %s, clone=%s)`, async (output, clone) => {
            const files = new Map<string, Uint8Array>([
                ["/a.ppm", Buffer.from("P3\n2 1\n255\n66 23 41 19 110 221\n")],
                ["/out.miff", Buffer.from("KEEP")],
            ]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = ["/a.ppm", ...(clone ? ["+clone"] : []), option, "-depth", "8", output];
            const argumentValues = createCommandArguments(args);
            const stdout: Uint8Array[] = [];
            const stderr: Uint8Array[] = [];
            const result = mode === "public" ? { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr.push(bytes); } },
            }), stderr: Buffer.concat(stderr).toString(), stdoutBytes: Buffer.concat(stdout) } : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe(
                "magick: delegate library support not built-in `/a.ppm' (FFTW) @ warning/fourier.c/ForwardFourierTransformImage/922.\n"
            );
            if (output === "rgb:-") {
                const bytes = Buffer.from(result.stdoutBytes ?? []);
                expect(bytes.toString("hex")).toBe("421729136edd".repeat(clone ? 2 : 1));
            } else {
                const bytes = mode === "retained" || mode === "public" ? await filesystem.readFile(output) : files.get(output)!;
                const saved = runMagickCliSync([output, "-format", "%z:%[fx:r];", "info:"], new Map([[output, bytes]]));
                expect(saved.exitCode).toBe(0);
                expect(saved.stdout).toBe("8:0.258824;");
            }
        });
    }
}
