import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI output for the PPM below.
const cases = [
    { operation: "-roll", geometry: "+1-1", output: ["-depth", "8", "rgb:/out"],
        expected: "6b88a56683a0bddaf714314ec7e401c2dffc193653708daa0f2c490a2744617e9bb8d5f2", encoding: "hex" },
    { operation: "-chop", geometry: "2x1+1+1", output: ["-format", "%wx%h %g %X %Y;", "info:/out"],
        expected: "2x2 2x2+0+0 +0 +0;", encoding: "utf8" },
    { operation: "-splice", geometry: "2x1+1+1", output: ["-format", "%wx%h %g %X %Y;", "info:/out"],
        expected: "6x4 6x4+0+0 +0 +0;", encoding: "utf8" },
] as const;

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    for (const wrapped of [true, false]) {
        it.each(cases)(`applies $operation geometry (${mode}, parentheses=${wrapped})`, async ({ operation, geometry, output, expected, encoding }) => {
            const input = Uint8Array.from([
                ...new TextEncoder().encode("P6\n4 3\n255\n"),
                ...Array.from({ length: 36 }, (_, i) => (29 * i + 10) % 256),
            ]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const files = new Map([["/in.ppm", input]]);
            const argv = ["/in.ppm", operation, wrapped ? `(${geometry})` : geometry, ...output];
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(bytes).toString(encoding)).toBe(expected);
        });
    }
}
