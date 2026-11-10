import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const colors = { r: [255, 0, 0, 255], g: [0, 255, 0, 255], b: [0, 0, 255, 255], y: [255, 255, 0, 255], w: [255, 255, 255, 255], k: [0, 0, 0, 255] };
const input = new Uint8Array([...new TextEncoder().encode("P6\n2 2\n255\n"), 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { options: [], extent: "3x2", width: 3, height: 2, pixels: "rgwbyw" },
        { options: [], extent: "3x3", width: 3, height: 3, pixels: "rgwbywwww" },
        { options: ["-gravity", "Southeast", "-background", "black"], extent: "3x3", width: 3, height: 3, pixels: "kkkkrgkby" },
        { options: [], extent: "1x1", width: 1, height: 1, pixels: "r" },
        { options: ["-gravity", "Southeast"], extent: "1x1", width: 1, height: 1, pixels: "y" },
        { options: ["-flip"], extent: "3x2", width: 3, height: 2, pixels: "bywrgw" },
        { options: [], extent: undefined, width: 2, height: 2, pixels: "rgby" },
    ])(`applies montage extent before layout (${mode}): $extent $options`, async ({ options, extent, width, height, pixels }) => {
        const files = new Map([["/tile.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/tile.ppm", input);
        const args = ["-geometry", "+0+0", "-tile", "x1", ...options, "/tile.ppm", "/tile.ppm", ...(extent ? ["-extent", extent] : []), "-depth", "8", "/out.ppm"];
        const argumentValues = createCommandArguments(["montage", ...args]);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMontageCliSync(args, files)
            : await runMontageCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.ppm") : files.get("/out.ppm")!);
        expect([output.width, output.height]).toEqual([width * 2, height]);
        const rows = Array.from({ length: height }, (_, row) => pixels.slice(row * width, (row + 1) * width));
        expect([...output.data]).toEqual(rows.flatMap(row => [...row, ...row].flatMap(pixel => colors[pixel as keyof typeof colors])));
    });
}
