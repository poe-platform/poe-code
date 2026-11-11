import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects empty lists at -sharpen, before later inputs.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "empty group", "after input"])(`requires an image at sharpen (%s, ${mode})`, async placement => {
        const images = ["xc:#50406080", "xc:#a08090c0", "+append"];
        const args = placement === "before input" ? ["-sharpen", "0x1", ...images]
            : placement === "after delete" ? ["xc:#50406080", "-delete", "0", "-sharpen", "0x1", "xc:#a08090c0"]
            : placement === "empty group" ? ["xc:#50406080", "(", "-sharpen", "0x1", "xc:#a08090c0", ")", "+append"]
            : [...images, "-sharpen", "0x1"];
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
        expect.soft(stderr).toBe(empty ? "magick: no images found for operation '-sharpen'\n" : "");
        expect(Buffer.concat(stdout).toString("hex")).toBe(empty ? "" : "2c234b6fad8a98d1");
    });
}
