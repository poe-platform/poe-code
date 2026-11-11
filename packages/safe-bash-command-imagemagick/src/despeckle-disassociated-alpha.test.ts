import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: despeckle discards disassociated alpha,
// but preserves RGB smoothing and ordinary active-alpha smoothing.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operations: ["-alpha", "disassociate"], channels: true, expected: "DirectClass sRGB |srgb  4.0" },
        { operations: ["-alpha", "disassociate", "-despeckle"], channels: true, expected: "DirectClass sRGB |srgb  3.0" },
        { operations: ["-alpha", "disassociate", "-despeckle"], channels: false, expected: "589bdf00" },
        { operations: ["-alpha", "disassociate"], channels: false, expected: "68abef80" },
        { operations: ["-despeckle"], channels: false, expected: "24466870" },
    ])(`${mode}: $operations (channels=$channels)`, async ({ operations, channels, expected }) => {
        const argv = ["xc:#34567880", ...operations, ...(channels
            ? ["-format", "%r|%[channels]", "info:"]
            : ["-alpha", "activate", "-depth", "8", "rgba:/out"])];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        if (channels) expect("stdout" in result ? result.stdout : stdout).toBe(expected);
        else {
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}
