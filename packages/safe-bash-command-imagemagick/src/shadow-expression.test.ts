import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["80x0+2+1", "%[fx:80]x0+2+1", "%[fx:100-10*h]x0+2+1", "%[fx:100-10*h]x%[fx:0]+%[fx:w-1]+%[fx:h-1]", "%[shadow-size]", "%[option:shadow-size]"])(
        `expands shadow geometry %s before resolving pixels and page (${mode})`, async geometry => {
            const input = encodeImage({ width: 3, height: 2,
                data: Uint8Array.from([0, 51, 102, 153, 204, 255].flatMap(alpha => [96, 160, 128, alpha])),
                format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true,
                virtualCanvas: { width: 11, height: 9, x: 4, y: 3 }
            }, { format: "png" }).data;
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["/input.png", "-background", "#204060", "-set", "option:shadow-size", "80x0+2+1",
                "-shadow", geometry, "-set", "option:shadow-size", "20x3+5+5", "PNG32:/out.png"];
            const backend = mode === "retained" ? { filesystem, cwd: "/" } : files;
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, backend);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([3, 2]);
            expect(output.virtualCanvas).toEqual({ width: 13, height: 10, x: 6, y: 4 });
            expect([...output.data]).toEqual([0, 41, 82, 122, 163, 204].flatMap(alpha => [32, 64, 96, alpha]));
        }
    );

    it(`evaluates shadow expressions separately for each image (${mode})`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:red", "-size", "3x4", "xc:red", "-shadow", "%[fx:100-10*h]x0+0+0", "-format", "%wx%h %[fx:a]\\n", "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("3x2 0.8\n3x4 0.6\n");
    });
}
