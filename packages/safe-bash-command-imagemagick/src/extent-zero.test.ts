import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 keeps the input dimension for a zero extent axis.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["0x3", 7, 3],
        ["4x0", 4, 5],
        ["0x0", 7, 5],
        ["0%", 7, 5],
        ["x3", 7, 3],
        ["4x", 4, 5],
    ] as const)(`preserves zero and omitted extent axes for %s (${mode})`, async (geometry, width, height) => {
        const pixels = Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const input = await sharp(pixels, { raw: { width: 7, height: 5, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-background", "none", "-extent", geometry, "PNG32:/out.png"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data).toEqual(Uint8Array.from({ length: width * height * 4 }, (_, i) =>
            i % 4 === 3 ? 255 : Math.floor(i / (width * 4)) * 7 + Math.floor(i / 4) % width + 1));
        expect(runIdentifyCliSync(["-format", "%wx%h %g", "/out.png"], new Map([["/out.png", bytes]])))
            .toMatchObject({ exitCode: 0, stdout: `${width}x${height} ${width}x${height}+0+0`, stderr: "" });
    });
}
