import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves both dimensions with #.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["info", "rgba"]) for (const operation of ["-shave", "-border", "-frame"]) {
        it.each([
            ["1x2#", 2], ["1x2", 2], ["1#", 1], ["1", 1],
        ] as const)(`${operation} %s preserves the raster and page (${mode}, ${format})`, async (geometry, vertical) => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", keep]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", keep);
            const args = ["-size", "9x7", "xc:red", "-repage", "11x9+2+1",
                "-bordercolor", "blue", "-mattecolor", "blue", operation, geometry,
                "-format", "%wx%h %W,%H,%X,%Y", "-depth", "8", `${format}:/out`];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
            const direction = operation === "-shave" ? -1 : 1;
            const width = 9 + direction * 2, height = 7 + direction * vertical * 2;
            if (format === "info") {
                expect(new TextDecoder().decode(output)).toBe(`${width}x${height} ${width + 2},${height + 2},+2,+1`);
                return;
            }
            const expected: number[] = [];
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const sourceX = x - direction, sourceY = y - direction * vertical;
                const inside = sourceX >= 0 && sourceX < 9 && sourceY >= 0 && sourceY < 7;
                expected.push(inside ? 255 : 0, 0, inside ? 0 : 255, 255);
            }
            expect(Array.from(output)).toEqual(expected);
        });
    }
}
