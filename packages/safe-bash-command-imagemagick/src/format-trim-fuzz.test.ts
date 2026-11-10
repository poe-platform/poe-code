import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    for (const format of ["%@", "%[bounding-box]"]) {
        it.each([
            { options: ["-define", "trim:edges=north"], geometry: "7x6+0+0", box: "0,0 7,6" },
            { options: ["-define", "trim:edges=east"], geometry: "4x6+0+0", box: "0,0 4,6" },
            { options: ["-define", "trim:edges=south"], geometry: "7x4+0+0", box: "0,0 7,4" },
            { options: ["-define", "trim:edges=west"], geometry: "6x6+1+0", box: "1,0 7,6" },
            { options: ["-define", "trim:edges=north,east"], geometry: "4x6+0+0", box: "0,0 4,6" },
            { options: ["-define", "trim:edges=north,east,south,west"], geometry: "3x4+1+0", box: "1,0 4,4" },
            { options: ["-define", "trim:edges=none"], geometry: "7x6+0+0", box: "0,0 7,6" },
            { options: ["-define", "trim:edges=east", "+define", "trim:edges"], geometry: "3x4+1+0", box: "1,0 4,4" },
            { options: [], geometry: "3x4+1+0", box: "1,0 4,4" },
            { options: ["-fuzz", "3%"], geometry: "2x2+2+2", box: "2,2 4,4" },
            { options: ["-fuzz", "3%", "+fuzz"], geometry: "3x4+1+0", box: "1,0 4,4" }
        ])(`${mode} formats ${format} with $options`, async ({ options, geometry, box }) => {
            const pixels = Array.from({ length: 30 }, () => [100, 120, 140]);
            pixels[1] = [102, 120, 140];
            pixels[14] = [26, 38, 54];
            pixels[15] = [50, 100, 130];
            pixels[20] = [69, 21, 90];
            pixels[21] = [200, 230, 17];
            const bytes = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...pixels.flat()]);
            const files = new Map([["/in.ppm", bytes], ["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, data] of files) await fs.writeFile(path, data);
            const args = ["/in.ppm", ...options, "-format", format, "info:/out"];
            let result;
            if (mode === "command") {
                const argumentValues = createCommandArguments(args);
                let stdout = "", stderr = "";
                const status = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
                });
                result = { ...status, stdout, stderr };
            } else result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "map" || mode === "sync" ? files.get("/out") : await fs.readFile("/out");
            expect(new TextDecoder().decode(output)).toBe(format === "%@" ? geometry : box);
            expect(mode === "map" || mode === "sync" ? files.get("/in.ppm") : await fs.readFile("/in.ppm")).toEqual(bytes);
        });
    }
}
