import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, Linux: fixed-seed RGB output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["2", "random", "00ffff00ffffff0000"],
        ["3", "random", "000000ffffffff0000"],
        ["2", "edge", "00000000ffffff0000"],
    ])(`repeats native seeded local thresholds via ${mode}: %s %s`, async (seed, virtualPixel, expected) => {
        for (let repeat = 0; repeat < 12; repeat++) {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const args = ["xc:#0d3257", "xc:#7ca1c6", "xc:#eb1035", "+append", "-seed", seed, "-virtual-pixel", virtualPixel, "-lat", "3x3+0", "-depth", "8", "rgb:/out"];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}
