import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 rejects these without replacing the destination.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...["-splice", "-chop", "-shave"].flatMap(operation =>
            ["()", "e", "E", "bad"].map(geometry => ({ operation, geometry, expected: "KEEP" }))),
        { operation: "-splice", geometry: "(2)", expected: "5x4" },
        // Modifiers alone still constitute geometry, even without dimensions.
        { operation: "-splice", geometry: "%", expected: "6x4" },
    ])(`validates $operation $geometry before writing (${mode})`, async ({ operation, geometry, expected }) => {
        const original = new TextEncoder().encode("KEEP");
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        const files = new Map([["/out", original]]);
        const argv = ["-size", "3x2", "xc:red", operation, geometry, "-format", "%wx%h", "info:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        expect(new TextDecoder().decode(output)).toBe(expected);
        expect(result.exitCode).toBe(expected === "KEEP" ? 1 : 0);
        if (expected === "KEEP") expect(diagnostic).toContain(`invalid argument for option '${operation}'`);
        else expect(diagnostic).toBe("");
    });
}
