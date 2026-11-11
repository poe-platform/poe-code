import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { multiplier: 1, pixel: "ffffff2d" },
        { multiplier: 2, pixel: "ffffff5a" },
        { multiplier: 6, pixel: "ffffffb3" },
    ])(`${mode}: bounds source alpha before applying shadow strength after multiplying by $multiplier`, async ({ multiplier, pixel }) => {
        const argv = ["xc:#33669940", "-channel", "A", "-evaluate", "multiply", String(multiplier),
            "+channel", "-shadow", "70x0+0+0", "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(pixel);
    });
}
