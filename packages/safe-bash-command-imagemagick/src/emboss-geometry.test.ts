import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "magick", "convert"] as const)("validates emboss geometry and preserves existing output (%s)", async mode => {
    const pixels = new Uint8Array(5 * 5 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.fill(255, 48, 52);
    const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
    const original = new TextEncoder().encode("KEEP");
    for (const geometry of ["bogus", "2xnope", "2x1junk", "", "2x1"]) {
        const files = new Map([["input.png", input], ["o.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["input.png", "-emboss", geometry, "PNG32:o.png"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("o.png")! : await fs.readFile("/o.png");
        expect.soft(result.stdout).toBe("");
        if (geometry === "2x1") {
            expect.soft(result.exitCode).toBe(0);
            expect.soft(result.stderr).toBe("");
            expect.soft(decodeImage(output).data).toEqual(pixels);
        } else {
            expect.soft(result.exitCode).toBe(1);
            expect.soft(result.stderr).toContain("invalid argument for option '-emboss'");
            expect.soft(output).toEqual(original);
        }
    }
});
