import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "magick", "convert"] as const)("rejects rotational blur without a current image and preserves the destination (%s)", async mode => {
    const pixels = Uint8Array.from({ length: 9 * 7 * 4 }, (_, i) => (i * 47 + 19) % 256);
    const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
    const original = new TextEncoder().encode("KEEP");
    for (const prefix of [[], ["input.png", "+delete"]]) {
        const files = new Map([["input.png", input], ["o.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = [...prefix, "-rotational-blur", "38", "input.png", "PNG32:o.png"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(1);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toContain("no images found for operation '-rotational-blur'");
        expect.soft(mode === "buffered" || mode === "sync" ? files.get("o.png") : await fs.readFile("/o.png")).toEqual(original);
    }
});
