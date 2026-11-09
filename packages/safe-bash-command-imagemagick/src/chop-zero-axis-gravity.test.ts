import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 uses page | image extent for zero axes during gravity adjustment.
const original = Array.from({ length: 20 }, (_, i) => i + 1);
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["5x4+0+0", "SouthEast", "2x0+0+1", "5x4 5x4+0+0", original, true],
        ["5x4+0+0", "SouthEast", "0x1+1+0", "5x4 5x4+0+0", original, true],
        ["5x4+0+0", "SouthEast", "2x0+0+0", "3x4 3x4+0+0", [1, 2, 3, 6, 7, 8, 11, 12, 13, 16, 17, 18], false],
        ["5x4+0+0", "SouthEast", "0x1+0+0", "5x3 5x3+0+0", original.slice(0, 15), false],
        ["5x4+0+0", "NorthWest", "2x0+0+1", "3x4 3x4+0+0", [3, 4, 5, 8, 9, 10, 13, 14, 15, 18, 19, 20], false],
        ["5x4+0+0", "NorthWest", "0x1+1+0", "5x3 5x3+0+0", original.slice(5), false],
        ["5x4+0+0", "Center", "2x0+0+0", "3x4 3x4+0+0", [1, 4, 5, 6, 9, 10, 11, 14, 15, 16, 19, 20], false],
        ["5x4+0+0", "Center", "0x1+0+0", "5x3 5x3+0+0", [...original.slice(0, 5), ...original.slice(10)], false],
        ["9x8+3+2", "Center", "2x0+0+0", "5x4 9x8+3+2", original, true],
        ["9x8+3+2", "Center", "0x1+0+0", "5x4 9x8+3+2", original, true],
        ["9x8+3+2", "Center", "2x0+0+2", "5x4 9x8+3+2", original, true],
        ["9x8+3+2", "Center", "2x0+0+4", "3x4 5x8+2+1", [1, 4, 5, 6, 9, 10, 11, 14, 15, 16, 19, 20], false],
        ["5x4+0+0", "SouthEast", "2x1+0+1", "3x3 3x3+0+0", [1, 2, 3, 6, 7, 8, 16, 17, 18], false],
        ["9x8+3+2", "Center", "2x1+0+1", "3x3 5x6+2+1", [1, 4, 5, 6, 9, 10, 16, 19, 20], false],
    ] as const)(`chops page %s with %s gravity and %s (${mode})`, async (page, gravity, geometry, expectedPage, values, warns) => {
        const pixels = Uint8Array.from(original.flatMap(value => [value, value, value, 255]));
        const input = await sharp(pixels, { raw: { width: 5, height: 4, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-repage", page, "-gravity", gravity, "-chop", geometry, "/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect(runMagickCliSync(["identify", "-format", "%wx%h %g", "/output.png"], new Map([["/output.png", bytes]])).stdout).toBe(expectedPage);
        expect(decodeImage(bytes).data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
        expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
    });
}
