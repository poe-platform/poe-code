import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects empty lists at -despeckle, before later inputs.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "empty group", "after input"])(`requires an image at despeckle (%s, ${mode})`, async placement => {
        const images = ["xc:#32406080"];
        const args = placement === "before input" ? ["-despeckle", ...images]
            : placement === "after delete" ? ["xc:red", "-delete", "0", "-despeckle", "xc:#32406080"]
            : placement === "empty group" ? ["xc:red", "(", "-despeckle", "xc:#32406080", ")", "+append"]
            : [...images, "-despeckle"];
        args.push("-depth", "8", "rgba:-");
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
        expect.soft(stderr).toBe(empty ? "magick: no images found for operation '-despeckle'\n" : "");
        expect(Buffer.concat(stdout).toString("hex")).toBe(empty ? "" : "22305070");
    });
}
