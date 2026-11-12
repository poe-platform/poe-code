import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: only an empty trim changes storage class.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: ["-trim"], expected: "DirectClass sRGB Alpha|1x1", warning: true },
        { operations: ["-trim", "-cycle", "1"], expected: "1x1", warning: true },
        { operations: [], expected: "PseudoClass sRGB |3x2", warning: false },
        { operations: ["-bordercolor", "white", "-border", "1", "-type", "Palette", "-trim"], expected: "PseudoClass sRGB |3x2", warning: false },
    ])(`${mode}: preserves storage class through $operations`, async ({ operations, expected, warning }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const argv = ["-size", "3x2", "xc:red", "-type", "Palette", ...operations, "-format", operations.includes("-cycle") ? "%wx%h" : "%r|%wx%h", "info:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe(warning ? "magick: geometry does not contain image 'red'\n" : "");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
