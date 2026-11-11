import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "after input"])(`requires an image at color-threshold (%s, ${mode})`, async placement => {
        const args = placement === "before input" ? ["-color-threshold", "black-white", "xc:red"]
            : placement === "after delete" ? ["xc:red", "+delete", "-color-threshold", "black-white", "xc:red"]
            : ["xc:red", "-color-threshold", "red-red"];
        args.push("-depth", "8", "gray:-");
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        let exitCode: number;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
        }
        const empty = placement !== "after input";
        expect.soft(exitCode).toBe(empty ? 1 : 0);
        expect.soft(stderr).toBe(empty ? "magick: no images found for operation '-color-threshold'\n" : "");
        expect(Buffer.concat(stdout).toString("hex")).toBe(empty ? "" : "ff");
    });
}
