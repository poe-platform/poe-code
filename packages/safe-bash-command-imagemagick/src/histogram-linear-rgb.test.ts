import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: linear RGB has numeric colors, sRGB has names.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const operation of [["-colorspace"], ["-set", "colorspace"]]) {
        it.each([
            { colorspace: "RGB", depth: 8 }, { colorspace: "sRGB", depth: 8 },
            { colorspace: "RGB", depth: 16 }, { colorspace: "sRGB", depth: 16 }
        ])(`preserves $colorspace histogram color names at depth $depth (${mode}, ${operation.join(" ")})`, async ({ colorspace, depth }) => {
            const source = Buffer.from("P3\n3 1\n255\n255 0 0 255 0 0 0 0 255\n");
            const files = new Map([["/in.ppm", source as Uint8Array]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", source);
            const argv = ["/in.ppm", ...operation, colorspace, "-depth", String(depth), "-format", "%c", "histogram:info:"];
            const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
            const argumentValues = createCommandArguments(argv);
            let result;
            if (mode === "command") {
                const execution = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { errors.push(bytes.slice()); } }
                });
                result = { ...execution, stdout: Buffer.concat(chunks).toString(), stderr: Buffer.concat(errors).toString() };
            } else {
                result = mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            }
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            const stdout = result.stdout;
            expect(stdout.trim().split("\n").map(line => line.trim())).toEqual([
                `1: (0,0,${depth === 16 ? 65535 : 255}) #${depth === 16 ? "00000000FFFF" : "0000FF"} ${colorspace === "RGB" ? "rgb(0,0,255)" : "blue"}`,
                `2: (${depth === 16 ? 65535 : 255},0,0) #${depth === 16 ? "FFFF00000000" : "FF0000"} ${colorspace === "RGB" ? "rgb(255,0,0)" : "red"}`
            ]);
        });
    }
}
