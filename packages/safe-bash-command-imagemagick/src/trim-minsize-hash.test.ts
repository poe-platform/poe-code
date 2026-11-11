import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["info", "PNG32"] as const) {
        it.each([
            ["4x3#", 4, 3, 1],
            ["3#x3", 3, 3, 2],
            ["4#", 4, 1, 1],
            ["4x3", 4, 3, 1],
            ["3x3", 3, 3, 2],
            ["4", 4, 1, 1],
        ] as const)(`preserves native trim minimum dimensions with %s (${mode}, ${format})`, async (size, width, height, left) => {
            // ImageMagick 7.1.2-35 Q16-HDRI: two red pixels on a 5x4 white canvas.
            const pixels = Array.from({ length: 20 }, (_, index) => index === 7 || index === 8 ? [255, 0, 0] : [255, 255, 255]);
            const input = new Uint8Array([...new TextEncoder().encode("P6\n5 4\n255\n"), ...pixels.flat()]);
            const files = new Map([["/in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const argv = ["/in.ppm", "-define", `trim:minSize=${size}`, "-trim", "-format", "%wx%h %g", `${format}:/out`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "info") expect(new TextDecoder().decode(output)).toBe(`${width}x${height} 5x4+${left}+1`);
            else {
                const decoded = decodeImage(output);
                expect([decoded.width, decoded.height]).toEqual([width, height]);
                const expected = [];
                for (let y = 1; y < 1 + height; y++) for (let x = left; x < left + width; x++) expected.push(...pixels[y * 5 + x]!, 255);
                expect(decoded.data).toEqual(new Uint8Array(expected));
            }
        });
    }
}
