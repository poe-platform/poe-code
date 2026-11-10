import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["PNG32", "info"] as const) {
        // ImageMagick 7.1.2-35 Q16-HDRI: minimum dimensions retain source margins.
        it.each([
            { minimum: "4x4", percent: "80", width: 4, height: 4, top: 1 },
            { minimum: "4x4", percent: "0", width: 4, height: 4, top: 1 },
            { minimum: "4", percent: "80", width: 4, height: 2, top: 2 },
            { minimum: "4x4", percent: undefined, width: 4, height: 4, top: 1 },
            { minimum: "0x0", percent: "80", width: 2, height: 2, top: 2 },
        ])(`${mode} ${format}: retains trim:minsize=$minimum with percent-background=$percent`, async test => {
            const pixels = Uint8Array.from({ length: 6 * 5 * 3 }, (_, i) => [100, 120, 140][i % 3]!);
            for (const [pixel, color] of [
                [1, [102, 120, 140]], [14, [26, 38, 54]], [15, [50, 100, 130]],
                [20, [69, 21, 90]], [21, [200, 230, 17]],
            ] as const) pixels.set(color, pixel * 3);
            const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...pixels]);
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.ppm", input], ["/out", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            await fs.writeFile("/out", keep);
            const argv = ["/in.ppm", "-fuzz", "3%", "-define", `trim:minsize=${test.minimum}`,
                ...(test.percent === undefined ? [] : ["-define", `trim:percent-background=${test.percent}`]),
                "-trim", "-format", "%wx%h %g", `${format}:/out`];
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
            if (format === "info") expect(new TextDecoder().decode(output)).toBe(`${test.width}x${test.height} 6x5+2+${test.top}`);
            else {
                const decoded = decodeImage(output);
                expect([decoded.width, decoded.height]).toEqual([test.width, test.height]);
                const expected = new Uint8Array(test.width * test.height * 4);
                for (let y = 0; y < test.height; y++) for (let x = 0; x < test.width; x++) {
                    const source = ((y + test.top) * 6 + x + 2) * 3;
                    expected.set([...pixels.subarray(source, source + 3), 255], (y * test.width + x) * 4);
                }
                expect(decoded.data).toEqual(expected);
            }
        });
    }
}
