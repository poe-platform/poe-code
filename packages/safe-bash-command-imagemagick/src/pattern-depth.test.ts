import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: natural PBM tiles keep depth 1;
// explicitly sized patterns use the build's quantum depth.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: ["pattern:horizontal"], hex: "00ffffff" },
        { input: ["pattern:checkerboard"], hex: ("99".repeat(15) + "66".repeat(15)).repeat(15) + ("66".repeat(15) + "99".repeat(15)).repeat(15) },
        { input: ["-size", "4x3", "pattern:horizontal"], hex: "0000000000000000ffffffffffffffffffffffffffffffff" },
        { input: ["-size", "4x3", "pattern:checkerboard"], hex: "999999999999999999999999999999999999999999999999" },
        { input: ["-size", "4x3", "pattern:horizontal", "-depth", "8"], hex: "00000000ffffffffffffffff" },
        { input: ["pattern:horizontal", "-depth", "8"], hex: "0000000000000000ffffffffffffffffffffffffffffffffffffffffffffffff" }
    ])(`${mode}: preserves raw pattern depth for $input`, async ({ input, hex }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = [...input, mode === "command" ? "gray:-" : "gray:/out"];
        const argumentValues = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
