import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: crop is skipped only when both dimensions are smaller.
const input = new Uint8Array([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Array.from({ length: 35 }, (_, i) => i + 1)]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["3x2+0+0<", 7, 5, 0, 0],
        ["3x2<", 7, 5, 0, 0],
        ["20x20<", 7, 5, 0, 0],
        ["3x2+0+0", 3, 2, 0, 0],
        ["3x2+99+99<", 7, 5, 0, 0],
        ["50%<", 7, 5, 0, 0],
        ["3x2@<", 7, 5, 0, 0],
        ["7x2+0+0<", 7, 2, 0, 0],
        ["6.6x2+0+0<", 7, 2, 0, 0],
        ["3x5+0+0<", 3, 5, 0, 0],
        ["20x2+0+0<", 7, 2, 0, 0],
        ["3x20+0+0<", 3, 5, 0, 0],
        ["20x20+1+1<", 6, 4, 1, 1],
    ] as const)(`applies crop size modifier %s (${mode})`, async (geometry, width, height, left, top) => {
        const files = new Map<string, Uint8Array>([["/input.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.pgm", input);
        const args = ["/input.pgm", "-crop", geometry, "/tile-%02d.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const retained = mode === "command" || mode === "retained";
        const names = retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()].map(name => name.slice(1));
        expect(names.filter(name => name.startsWith("tile-"))).toEqual(["tile-00.png"]);
        const output = decodeImage(retained ? await filesystem.readFile("/tile-00.png") : files.get("/tile-00.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 }).toEqual({ width: 7, height: 5, x: left, y: top });
        expect(output.data).toEqual(Uint8Array.from({ length: width * height * 4 }, (_, i) => {
            const pixel = Math.floor(i / 4);
            return i % 4 === 3 ? 255 : (top + Math.floor(pixel / width)) * 7 + left + pixel % width + 1;
        }));
    });
}
