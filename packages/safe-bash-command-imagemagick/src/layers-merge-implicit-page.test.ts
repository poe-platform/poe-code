import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 retains the first 5x3 page even when the raster grows to 7x4.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const [offset, dx, dy] of [["+2+1", 2, 1], ["-2-1", -2, -1], ["+0+0", 0, 0]] as const) {
        for (const flatten of [false, true]) {
            it(`${mode} preserves the implicit page with ${offset} layers (flatten: ${flatten})`, async () => {
                const input = Uint8Array.from([...new TextEncoder().encode("P6\n5 3\n255\n"), ...Array.from({ length: 45 }, (_, i) => i)]);
                const files = new Map([["/in.ppm", input]]);
                const fs = createMemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const args = ["/in.ppm", "(", "+clone", "-repage", offset, ")", "-layers", "Merge",
                    ...(flatten ? ["-flatten"] : []), "PNG32:/out.png"];
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write() {} },
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                const width = flatten ? 5 : 5 + Math.abs(dx), height = flatten ? 3 : 3 + Math.abs(dy);
                const left = flatten ? 0 : Math.min(0, dx), top = flatten ? 0 : Math.min(0, dy);
                expect([output.width, output.height]).toEqual([width, height]);
                expect(output.virtualCanvas ?? { width, height, x: 0, y: 0 }).toEqual({ width: 5, height: 3, x: left, y: top });
                const expected = new Uint8Array(width * height * 4).fill(255);
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const gx = x + left, gy = y + top;
                        const overlay = gx >= dx && gx < dx + 5 && gy >= dy && gy < dy + 3;
                        const sx = overlay ? gx - dx : gx, sy = overlay ? gy - dy : gy;
                        if (sx >= 0 && sx < 5 && sy >= 0 && sy < 3) {
                            const sample = (sy * 5 + sx) * 3;
                            expected.set([sample, sample + 1, sample + 2], (y * width + x) * 4);
                        }
                    }
                }
                expect(output.data).toEqual(expected);
            });
        }
    }
}
