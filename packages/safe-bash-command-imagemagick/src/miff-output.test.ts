import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const output of ["mid.miff", "MIFF:mid.bin"]) for (const count of [1, 2]) {
    it.each(["-write", "+write", "final"])(`preserves the image list after %s MIFF in ${mode}, ${output}, frames=${count}`, async option => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const pixels = [255, 0, 0, 255, 0, 0, 255, 255];
        for (const [index, name] of ["r.png", "b.png"].entries()) {
            const { data } = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", depth: "uchar", density: 72, channels: 4, hasAlpha: true, data: new Uint8Array(pixels.slice(index * 4, index * 4 + 4)) }, { format: "png" });
            files.set(name, data);
            await filesystem.writeFile(`/${name}`, data);
        }
        const inputs = ["r.png", "b.png"].slice(0, count);
        const path = output.startsWith("MIFF:") ? output.slice(5) : output;
        const args = option === "final" ? [...inputs, output] : [...inputs, option, output, "+append", "out.png"];
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
        const bytes = retained ? await filesystem.readFile(`/${path}`) : files.get(path)!;
        let offset = 0;
        for (const pixel of [pixels.slice(0, 4), pixels.slice(4)].slice(0, count)) {
            const end = bytes.indexOf(26, offset);
            expect(new TextDecoder().decode(bytes.subarray(offset, end))).toContain("id=ImageMagick");
            expect([...bytes.subarray(end + 1, end + 5)]).toEqual(pixel);
            offset = end + 5;
        }
        expect(offset).toBe(bytes.length);
        if (option === "final") return;
        const final = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([final.width, final.height]).toEqual([count, 1]);
        expect([...final.data]).toEqual(pixels.slice(0, count * 4));
    });
}
}
