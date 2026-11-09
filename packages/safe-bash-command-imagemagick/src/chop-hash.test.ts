import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick preserves both axes and offsets with a trailing #.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["2x2+1+1", [1, 4, 5, 6, 7, 22, 25, 26, 27, 28, 29, 32, 33, 34, 35]],
        ["2x2+1+1#", [1, 4, 5, 6, 7, 22, 25, 26, 27, 28, 29, 32, 33, 34, 35]],
        ["2x2", [17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35]],
        ["2x2#", [17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35]],
    ] as const)(`chops %s with native dimensions and pixels (${mode})`, async (geometry, values) => {
        const pixels = Uint8Array.from({ length: 140 }, (_, i) => i % 4 === 3 ? 255 : i % 4 === 0 ? Math.floor(i / 4) + 1 : 0);
        const input = await sharp(pixels, { raw: { width: 7, height: 5, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-chop", geometry, "PNG32:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([5, 3]);
        expect(output.data).toEqual(Uint8Array.from(values.flatMap(value => [value, 0, 0, 255])));
    });
}
