import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["info", "PNG32"] as const) {
        it.each([
            ["3%", 3, 3, 2, 2],
            ["x3%", 3, 3, 2, 2],
            ["80%", 6, 5, 0, 0],
            ["3x3", 3, 3, 2, 2],
            ["3x", 3, 2, 2, 2],
            ["x3", 2, 3, 2, 2],
        ] as const)(`matches native trim minimum size %s (${mode}, ${format})`, async (size, width, height, left, top) => {
            // Native ImageMagick 7.1.2-35 Q16-HDRI geometry and crop controls.
            const pixels = Array.from({ length: 30 }, () => [100, 120, 140]);
            pixels[1] = [102, 120, 140];
            pixels[14] = [26, 38, 54];
            pixels[15] = [50, 100, 130];
            pixels[20] = [69, 21, 90];
            pixels[21] = [200, 230, 17];
            const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...pixels.flat()]);
            const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(name, bytes);
            const argv = ["/in.ppm", "-fuzz", "3%", "-define", `trim:minsize=${size}`, "-trim", "-format", "%wx%h %g", `${format}:/out`];
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
            if (format === "info") expect(new TextDecoder().decode(output)).toBe(`${width}x${height} 6x5+${left}+${top}`);
            else {
                const decoded = decodeImage(output);
                expect([decoded.width, decoded.height]).toEqual([width, height]);
                const expected = [];
                for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) expected.push(...pixels[y * 6 + x]!, 255);
                expect(decoded.data).toEqual(new Uint8Array(expected));
            }
        });
    }
}
