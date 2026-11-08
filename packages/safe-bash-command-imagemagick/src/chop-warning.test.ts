import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick warns on missed or consuming chops, while preserving the image.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["6x5", true],
        ["5x1", true],
        ["1x3", true],
        ["2x1+6+0", true],
        ["2x1+0+4", true],
        ["2x1-3+0", true],
        ["2x1+0-2", true],
        ["2x1+5+0", false],
    ] as const)(`preserves pixels and reports chop %s warnings (${mode})`, async (geometry, warns) => {
        const pixels = Uint8Array.from({ length: 60 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) + 1) * 10);
        const input = await sharp(pixels, { raw: { width: 5, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-chop", geometry, "/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([5, warns ? 3 : 2]);
        expect(output.data).toEqual(warns ? pixels : pixels.slice(20));
    });
}
