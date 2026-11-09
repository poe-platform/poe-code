import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";



for (const mode of ["sync", "buffered", "retained", "command"]) for (const depth of [8, 16]) {
    const pixels = Uint8Array.from({ length: 24 * depth / 8 }, (_, i) => i);
    const input = new Uint8Array([...new TextEncoder().encode(`P6\n4 2\n${depth === 16 ? 65535 : 255}\n`), ...pixels]);
    it.each([
        ["2x1+0+0", "+2+1", [0, 1, 2, 3, 4, 5, 0, 1]],
        ["3x1+0+0", "+1+0", [0, 0, 0, 0, 4, 5, 6, 7]],
        ["3x1+1+0", "+0+0", [1, 2, 3, 3, 4, 5, 6, 7]],
        ["4x1+0+0", "+0+1", [0, 1, 2, 3, 0, 1, 2, 3]]
    ])(`copies pixels in native scan order (${mode}, ${depth}-bit): %s %s`, async (geometry, destination, indices) => {
        const files = new Map([["in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["in.ppm", "-copy", geometry, destination, "-depth", String(depth), depth === 8 ? "rgb:out.rgb" : "out.png"];
        let stderr = "";
        const result = mode === "command"
            ? await createMagickCommand().execute({ command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
            : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const name = depth === 8 ? "out.rgb" : "out.png";
        const actual = mode === "sync" || mode === "buffered" ? files.get(name)! : await fs.readFile(`/${name}`);
        if (depth === 8) expect([...actual]).toEqual(indices.flatMap(index => [...pixels.subarray(index * 3, (index + 1) * 3)]));
        else expect([...decodeImage(actual).data16!]).toEqual(indices.flatMap(index => [0, 1, 2].map(channel => {
            const position = (index * 3 + channel) * 2;
            return pixels[position]! * 256 + pixels[position + 1]!;
        }).concat(65535)));
    });
}

it("propagates overlapping copies down rows as native ImageMagick does", () => {
    const pixels = Uint8Array.from({ length: 36 }, (_, i) => i);
    const files = new Map([["in.ppm", new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...pixels])]]);
    expect(runMagickCliSync(["in.ppm", "-copy", "3x2+0+0", "+1+1", "-depth", "8", "rgb:out.rgb"], files).exitCode).toBe(0);
    expect([...files.get("out.rgb")!]).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 8, 4, 0, 1].flatMap(index => [...pixels.subarray(index * 3, index * 3 + 3)]));
});
