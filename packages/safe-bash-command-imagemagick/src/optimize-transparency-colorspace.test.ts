import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete RGBA sequences, including transparent RGB.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["HSL", "Lab", "XYZ", "HWB", "sRGB", "Gray", "CMYK"])(`${mode} preserves optimized alpha through %s to sRGB`, async (colorspace) => {
        const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const argv = ["xc:#2060b0", "xc:#2060b0", "-colorspace", colorspace,
            "-layers", "OptimizeTransparency", "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, new Map())
            : await runConvertCli(argv, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(output).toString("hex")).toBe(colorspace === "Gray" ? "585858ff58585800" : "2060b0ff2060b000");
    });
}
