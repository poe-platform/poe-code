import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

for (const setting of ["define", "set"] as const) {
    for (const format of ["info", "gray"] as const) {
        it.each([
            ["6:4", 6, 4, 1, 1],
            ["2:4", 3, 4, 2, 1],
            ["6x4", 6, 4, 1, 1],
            ["2x4", 3, 4, 2, 1],
        ] as const)(`retains native trim dimensions, offsets and pixels for %s via -${setting} (${format})`, async (size, width, height, left, top) => {
            // Native ImageMagick 7.1.2-35 Q16-HDRI: three white pixels on a 7x5 black canvas.
            const pixels = Array.from({ length: 35 }, (_, index) => index >= 16 && index <= 18 ? 255 : 0);
            const input = new Uint8Array([...new TextEncoder().encode("P6\n7 5\n255\n"), ...pixels.flatMap(value => [value, value, value])]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const options = setting === "define" ? ["-define", `trim:minSize=${size}`] : ["-set", "option:trim:minSize", size];
            const args = createCommandArguments([
                "/in.ppm", ...options, "-trim", "-format", "%wx%h%X%Y", "-depth", "8", `${format}:/out`,
            ]);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const output = await fs.readFile("/out");
            if (format === "info") {
                expect(new TextDecoder().decode(output)).toBe(`${width}x${height}+${left}+${top}`);
                return;
            }
            const expected = [];
            for (let y = top; y < top + height; y++) expected.push(...pixels.slice(y * 7 + left, y * 7 + left + width));
            expect(output).toEqual(new Uint8Array(expected));
        });
    }
}
