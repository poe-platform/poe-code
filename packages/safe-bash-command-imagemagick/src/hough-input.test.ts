import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "magick", "convert"] as const) {
    it.each(["before input", "after delete", "empty group", "after input"])(`requires a current image for Hough lines (%s, ${mode})`, async placement => {
        const { data } = encodeImage({
            width: 3, height: 2, data: Uint8Array.from({ length: 24 }, (_, index) => index % 4 === 3 ? 255 : 0),
            format: "tiff", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, orientation: 6
        }, { format: "tiff" });
        const files = new Map([["/input.tiff", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.tiff", data);
        const operation = ["-hough-lines", "1x1+3"];
        const args = placement === "before input" ? [...operation, "/input.tiff"]
            : placement === "after delete" ? ["/input.tiff", "+delete", ...operation, "/input.tiff"]
            : placement === "empty group" ? ["/input.tiff", "(", ...operation, "/input.tiff", ")"]
            : ["/input.tiff", ...operation];
        args.push("-format", "%wx%h", "info:");
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const valid = placement === "after input";
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft(result.stdout).toBe(valid ? "3x2" : "");
        if (valid) expect.soft(result.stderr).toBe("");
        else expect.soft(result.stderr).toContain("no images found for operation '-hough-lines'");
    });
}
