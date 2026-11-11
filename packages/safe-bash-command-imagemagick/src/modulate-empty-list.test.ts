import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects empty current lists at -modulate.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["before input", ["-modulate", "80", "xc:red"]],
        ["after deletion", ["xc:blue", "-delete", "0", "-modulate", "80", "xc:red"]],
        ["empty group", ["xc:blue", "(", "-modulate", "80", "xc:red", ")"]],
        ["active image", ["xc:red", "-modulate", "80"]],
    ] as const)(`${mode}: modulate with %s`, async (location, input) => {
        const argv = [...input, "-depth", "8", "rgb:-"];
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = "stdout" in result ? Buffer.from(result.stdoutBytes ?? result.stdout) : Buffer.concat(stdout);
        if (location === "active image") {
            expect(result.exitCode).toBe(0);
            expect(output.toString("hex")).toBe("cc0000");
        } else {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-modulate'");
            expect(output.length).toBe(0);
        }
    });
}
