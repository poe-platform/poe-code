import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves both incomplete rectangles.
const pixels = Uint8Array.from({ length: 36 }, (_, i) => (17 * i + 3) % 256);
const cases = [
    { geometry: "1,x2", warns: true, expected: pixels, size: "4x3" },
    { geometry: "1:x2", warns: true, expected: pixels, size: "4x3" },
    { geometry: "1x2+1+1", warns: false, expected: new Uint8Array([...pixels.slice(0, 3), ...pixels.slice(6, 12)]), size: "3x1" },
    { geometry: "0x0", warns: false, expected: pixels, size: "4x3" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["rgb", "info"]) {
        it.each(cases)(`preserves chop $geometry pixels and dimensions (${mode}, ${format})`, async ({ geometry, warns, expected, size }) => {
            const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...pixels]);
            const files = new Map([["/in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const argv = ["/in.ppm", "-chop", geometry, "-depth", "8", "-format", "%wx%h", `${format}:${mode === "command" ? "-" : "/out"}`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const stdout: number[] = [];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(...bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
            const output = mode === "command" ? new Uint8Array(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(output).toEqual(format === "info" ? new TextEncoder().encode(size) : expected);
        });
    }
}
