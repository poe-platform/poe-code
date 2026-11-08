import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Dimensions and pixels verified against native ImageMagick on a 5x3 gray grid.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["+2+1", 2, 1, [10, 20]],
        ["+1+1", 1, 1, [10]],
        ["+2+1%", 2, 1, [10, 20]],
        ["3x2+2+1", 2, 1, [10, 20]],
        ["0x0+2+1", 5, 3, Array.from({ length: 15 }, (_, i) => (i + 1) * 10)],
        ["x2+2+1", 5, 1, [10, 20, 30, 40, 50]],
    ] as const)(`chops %s with native dimensions and pixels (${mode})`, async (geometry, width, height, values) => {
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
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
    });
}
