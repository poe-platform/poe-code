import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["-write", "+write"])(`preserves the image list after %s GIF in ${mode}`, async option => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const pixels = [255, 0, 0, 255, 0, 0, 255, 255];
        for (const [index, name] of ["r.png", "b.png"].entries()) {
            const { data } = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", depth: "uchar", density: 72, channels: 4, hasAlpha: true, data: new Uint8Array(pixels.slice(index * 4, index * 4 + 4)) }, { format: "png" });
            files.set(name, data);
            await filesystem.writeFile(`/${name}`, data);
        }
        const args = ["r.png", "b.png", option, "mid.gif", "+append", "out.png"];
        const retained = mode === "retained" || mode === "command";
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const intermediate = decodeImage(retained ? await filesystem.readFile("/mid.gif") : files.get("mid.gif")!, { animated: true });
        expect(intermediate.pages).toBe(2);
        expect([...intermediate.data]).toEqual(pixels);
        const final = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([final.width, final.height]).toEqual([2, 1]);
        expect([...final.data]).toEqual(pixels);
    });
}
