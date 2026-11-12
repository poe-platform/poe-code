import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI exit status and RGBA bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { quantize: true, shifts: [], expected: "114477ff2233ddff" },
        { quantize: true, shifts: [0], expected: "114477ff2233ddff" },
        { quantize: true, shifts: [1], expected: "2233ddff114477ff" },
        { quantize: true, shifts: [1, -1], expected: "114477ff2233ddff" },
        { quantize: false, shifts: [1], expected: "2233ddff114477ff" },
    ])(`${mode}: preserves palette precision (linear=$quantize, shifts=$shifts)`, async ({ quantize, shifts, expected }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["xc:#114477ff", "xc:#2233ddff", "+append", ...(quantize ? ["-quantize", "RGB"] : []), "+dither", "-colors", "4", ...shifts.flatMap(shift => ["-cycle", String(shift)]), "-colorspace", "sRGB", "-depth", "8", mode === "command" ? "rgba:-" : "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const stdout: Uint8Array[] = [];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
