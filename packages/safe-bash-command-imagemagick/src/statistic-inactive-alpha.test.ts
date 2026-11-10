import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, big-endian 16-bit raw output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "deactivated mean", operators: ["-alpha", "deactivate", "-statistic", "Mean", "3x1", "-alpha", "extract"], format: "gray", expected: "40408080c0c0" },
        { name: "deactivated gradient", operators: ["-alpha", "deactivate", "-statistic", "Gradient", "3x1", "-alpha", "extract"], format: "gray", expected: "40408080c0c0" },
        { name: "deactivated without statistic", operators: ["-alpha", "deactivate", "-alpha", "extract"], format: "gray", expected: "40408080c0c0" },
        { name: "active mean", operators: ["-statistic", "Mean", "3x1", "-alpha", "extract"], format: "gray", expected: "55ab8080ab55" },
        { name: "deactivated RGBA output", operators: ["-alpha", "deactivate", "-statistic", "Mean", "3x1"], format: "rgba", expected: "606060609b45ffff7b2565bb8080ffff95eb6b1565bbffff" },
    ])(`${mode}: $name`, async ({ operators, format, expected }) => {
        const argv = ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", ...operators,
            "-depth", "16", "-endian", "MSB", `${format}:${mode === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv), stdout: Buffer[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
