import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps the parsed dimension prefix.
const cases = [
    { operation: "-splice", geometry: "1x2e", expected: "4x4", warning: false },
    { operation: "-splice", geometry: "1x1\\", expected: "4x3", warning: false },
    { operation: "-chop", geometry: "1x2E", expected: "3x2", warning: true },
    { operation: "-chop", geometry: "1x1\\", expected: "2x1", warning: false },
    { operation: "-shave", geometry: "1x2e", expected: "3x2", warning: true },
    { operation: "-splice", geometry: "1x2e0", expected: "4x4", warning: false },
    { operation: "-splice", geometry: "1x1", expected: "4x3", warning: false },
    { operation: "-chop", geometry: "1x1", expected: "2x1", warning: false },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves dimensions for $operation $geometry`, async ({ operation, geometry, expected, warning }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const argv = ["-size", "3x2", "xc:red", operation, geometry, "-format", "%wx%h", "info:/out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        if (warning) expect(diagnostic).toContain("geometry does not contain image");
        else expect(diagnostic).toBe("");
    });
}
