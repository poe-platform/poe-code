import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 expands the geometry for each image in the list.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { geometry: "%[fx:w]x%[fx:h]", siblings: false, borders: [[3, 2]], info: "9x6|9x6+0+0;" },
        { geometry: "3x2", siblings: false, borders: [[3, 2]], info: "9x6|9x6+0+0;" },
        { geometry: "%[fx:t+2]x2", siblings: true, borders: [[2, 2], [3, 2]], info: "7x6|7x6+0+0;11x5|11x5+0+0;" },
        { geometry: "%[fx:u[1].w]x2", siblings: true, borders: [[5, 2], [5, 2]], info: "13x6|13x6+0+0;15x5|15x5+0+0;" },
        { geometry: "4x3", siblings: true, borders: [[4, 3], [4, 3]], info: "11x8|11x8+0+0;13x7|13x7+0+0;" },
    ])(`${mode}: expands $geometry (siblings: $siblings)`, async ({ geometry, siblings, borders, info }) => {
        for (const format of ["info", "rgb"]) {
            const input = Uint8Array.from({ length: 18 }, (_, index) => index + 1);
            const files = new Map([["/in.rgb", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.rgb", input);
            const args = ["-size", "3x2", "-depth", "8", "rgb:/in.rgb",
                ...(siblings ? ["-size", "5x1", "xc:red"] : []), "-border", geometry,
                "-format", "%wx%h|%g;", `${format}:/out`];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            if (format === "info") {
                expect(new TextDecoder().decode(output)).toBe(info);
                continue;
            }
            const expected: number[] = [];
            for (const [index, [left, top]] of borders.entries()) {
                const width = index === 0 ? 3 : 5, height = index === 0 ? 2 : 1;
                for (let y = -top!; y < height + top!; y++) for (let x = -left!; x < width + left!; x++) {
                    if (x < 0 || x >= width || y < 0 || y >= height) expected.push(223, 223, 223);
                    else if (index === 1) expected.push(255, 0, 0);
                    else expected.push(...input.subarray((y * width + x) * 3, (y * width + x + 1) * 3));
                }
            }
            expect(output).toEqual(Uint8Array.from(expected));
        }
    });
}
