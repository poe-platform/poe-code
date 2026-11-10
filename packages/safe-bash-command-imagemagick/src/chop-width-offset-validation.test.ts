import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick rejects scalar widths with offsets before writing the output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["3+1+1", 1, "4b454550"],
        ["3+1", 1, "4b454550"],
        ["8+1+1", 1, "4b454550"],
        ["bogus", 1, "4b454550"],
        ["+1+1", 0, "00"],
        ["3x2+1+1", 0, "00202890b0b8c0e0e8"],
    ] as const)(`validates chop %s without overwriting on failure (${mode})`, async (geometry, exitCode, expected) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n6 5\n255\n"), ...Uint8Array.from({ length: 30 }, (_, i) => i * 8)]);
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["in.pgm", input], ["out", sentinel]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pgm", input);
        await filesystem.writeFile("/out", sentinel);
        const args = ["in.pgm", "-chop", geometry, "-depth", "8", "gray:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(exitCode);
        expect("stderr" in result ? result.stderr : stderr).toBe(exitCode ? `magick: invalid argument for option '-chop': ${geometry}\n` : "");
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
