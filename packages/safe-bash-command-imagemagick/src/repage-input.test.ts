import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { args: ["-repage", "4x3+1+1", "/input.png"], error: "-repage" },
        { args: ["+repage", "/input.png"], error: "+repage" },
        { args: ["-repage", "bad", "/input.png"], error: "-repage" },
        { args: ["/input.png", "+delete", "-repage", "4x3+1+1", "/input.png"], error: "-repage" },
        { args: ["/input.png", "(", "+repage", "/input.png", ")"], error: "+repage" },
        { args: ["-page", "6x5+1+1", "/input.png"], canvas: { width: 6, height: 5, x: 1, y: 1 } },
        { args: ["/input.png", "-repage", "6x5+1+1"], canvas: { width: 6, height: 5, x: 1, y: 1 } },
        { args: ["-page", "6x5+1+1", "/input.png", "+repage"], canvas: undefined },
    ])(`${mode}: repage requires a current image: $args`, async ({ args, error, canvas }) => {
        // Six RGB colors from the native ImageMagick 7.1.2-35 reproduction.
        const pixels = Uint8Array.from([
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
            255, 255, 0, 255, 0, 255, 255, 255, 255, 0, 255, 255,
        ]);
        const input = encodeImage({ width: 3, height: 2, data: pixels, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png", forceOpaque: true }).data;
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/input.png", input], ["/output.png", sentinel]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        await filesystem.writeFile("/output.png", sentinel);
        const argv = [...args, "PNG32:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
        const output = mode === "sync" || mode === "buffered" ? files.get("/output.png")! : await filesystem.readFile("/output.png");
        if (error) {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain(`no images found for operation '${error}'`);
            expect(output).toEqual(sentinel);
        } else {
            expect(result.exitCode).toBe(0);
            const image = decodeImage(output);
            expect(image).toMatchObject({ width: 3, height: 2 });
            expect(image.virtualCanvas).toEqual(canvas);
            expect(image.data).toEqual(pixels);
        }
    });
}
