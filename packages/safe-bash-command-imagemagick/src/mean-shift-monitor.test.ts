import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
    { options: [], monitored: false },
    { options: ["-monitor"], monitored: true },
    { options: ["-monitor", "+monitor"], monitored: false },
    { options: ["+monitor", "-monitor"], monitored: true }
])(`reports mean-shift progress without changing pixels via ${mode}: $options`, async ({ options, monitored }) => {
    const bytes = Buffer.concat([Buffer.from("P6\n7 5\n255\n"), Buffer.from(Array.from({ length: 105 }, (_, i) =>
        (Math.floor(i / 3) % 7 * 31 + Math.floor(i / 21) * 47 + i % 3 * 53) % 256))]);
    const files = new Map([["/in.ppm", bytes]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", bytes);
    const operation = ["-mean-shift", "5x5+55%"];
    const args = ["/in.ppm", ...options, ...operation, "+monitor", ...operation, "-depth", "8", "rgba:-"];
    const baseline = runMagickCliSync(["/in.ppm", ...operation, ...operation, "-depth", "8", "rgba:-"], files);
    let stderr: string, output: Uint8Array, exitCode: number;
    if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        const stdoutChunks: Uint8Array[] = [], stderrChunks: Uint8Array[] = [];
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdoutChunks.push(chunk); } },
            stderr: { async write(chunk) { stderrChunks.push(chunk); } }
        });
        exitCode = result.exitCode;
        output = Buffer.concat(stdoutChunks);
        stderr = Buffer.concat(stderrChunks).toString();
    } else {
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        exitCode = result.exitCode;
        output = result.stdoutBytes!;
        stderr = result.stderr;
    }
    expect(exitCode).toBe(0);
    expect(Buffer.from(output)).toEqual(Buffer.from(baseline.stdoutBytes!));
    expect(output.length).toBe(140);
    expect(stderr).toBe(monitored ? "MeanShift/Image[/in.ppm]: 100% complete\n" : "");
});
