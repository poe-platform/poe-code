import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { inputs: ["-dispose", "Previous", "+dispose", "xc:red"], expected: "Undefined;" },
        { inputs: ["+dispose", "xc:red"], expected: "Undefined;" },
        { inputs: ["-dispose", "Previous", "xc:red"], expected: "Previous;" },
        { inputs: ["xc:red"], expected: "Undefined;" },
        { inputs: ["-dispose", "Previous", "xc:red", "+dispose", "xc:blue"], expected: "Previous;Undefined;" },
        { inputs: ["+dispose", "-dispose", "Background", "xc:red"], expected: "Background;" }
    ])(`${mode}: frame disposal for $inputs`, async ({ inputs, expected }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const args = [...inputs, "-format", "%D;", "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : mode === "buffered" ? await runMagickCli(args, files)
            : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        expect(new TextDecoder().decode(mode === "command" ? await fs.readFile("/out") : files.get("out"))).toBe(expected);
    });
}

for (const retained of [false, true]) {
    it(`mogrify accepts +dispose without consuming the filename (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        expect(runMagickCliSync(["xc:red", "in.miff"], files).exitCode).toBe(0);
        await fs.writeFile("/in.miff", files.get("in.miff")!);
        const result = await runMogrifyCli(["-dispose", "Previous", "+dispose", "in.miff"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = retained ? await fs.readFile("/in.miff") : files.get("in.miff")!;
        expect(runMagickCliSync(["in.miff", "-format", "%D;", "info:"], new Map([["in.miff", output]])))
            .toMatchObject({ exitCode: 0, stdout: "Undefined;", stderr: "" });
    });
}
