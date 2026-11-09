import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "magick", "convert"] as const)("rejects wavelet denoise without a current image and preserves the destination (%s)", async mode => {
    const input = await sharp({ create: { width: 8, height: 8, channels: 4, background: "red" } }).png().toBuffer();
    const original = new TextEncoder().encode("KEEP");
    for (const prefix of [[], ["input.png", "+delete"]]) {
        const files = new Map([["input.png", input], ["o.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = [...prefix, "-wavelet-denoise", "6%", "input.png", "PNG32:o.png"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(1);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toContain("no images found for operation '-wavelet-denoise'");
        expect.soft(mode === "buffered" || mode === "sync" ? files.get("o.png") : await fs.readFile("/o.png")).toEqual(original);
    }
});
