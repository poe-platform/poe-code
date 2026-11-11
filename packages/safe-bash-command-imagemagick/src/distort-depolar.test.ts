import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n255 255 0  0 255 255  255 0 255\n");

// ImageMagick 7.1.2-35 Q16-HDRI reference output for the six labeled pixels.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["-distort", "DePolar", "0", "3x2 3x2+0+0;", "37dc4b00ffbf15c882a66e0b00bfbf1559b1"],
        ["+distort", "DePolar", "0", "4x1 4x1+0+0;", "5ab2185af28d4da5e70da572"],
        ["-distort", "DePolar", "-1", "3x2 3x2+0+0;", "64b72b00fff21b9b8eae00000026260000ae"],
        ["-distort", "DePolar", "1,0.25,1.5,1,0,180", "3x2 3x2+0+0;", "31c7e7388fb707c7505279cb6830e7007952"],
        ["-distort", "DePolar", "1,0,1.5,1,90", "3x2 3x2+0+0;", "09df5f40df6017dfc0008851bf9f205188d9"],
        ["-distort", "AffineProjection", "1,0,0,1,1,0", "3x2 3x2+0+0;", "000000ff000000ff00000000ffff0000ffff"],
    ])(`renders %s %s %s (${mode})`, async (operator, method, coefficients, geometry, pixels) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-virtual-pixel", "black", "-filter", "point", operator!, method!, coefficients!, "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(args), output: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { output.push(chunk.slice()); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            expect(Buffer.concat(output)).toEqual(Buffer.concat([Buffer.from(geometry!), Buffer.from(pixels!, "hex")]));
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: geometry, stderr: "" });
            expect(Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(pixels);
        }
    });
}

for (const retained of [false, true]) {
    it.each([
        ["default filter", ["-distort", "DePolar", "0"], "3x2 3x2+0+0;", "2eff4c14ffca03ea8fbe770012cac8125dc5"],
        ["viewport", ["-filter", "point", "-define", "distort:viewport=2x1+1+1", "-distort", "DePolar", "0"], "2x1 2x1+1+1;", "37dc4b00ffbf"],
        ["nearest interpolation", ["-filter", "point", "-interpolate", "nearest", "-distort", "DePolar", "0"], "3x2 3x2+0+0;", "00ff0000ffff00ff00ff000000ffff0000ff"],
        ["page", ["-filter", "point", "-set", "page", "9x8+2+3", "-distort", "DePolar", "0"], "3x2 9x8+0+0;", "000000000000000000000000000000000000"],
        ["best-fit page", ["-filter", "point", "-set", "page", "9x8+2+3", "+distort", "DePolar", "0"], "4x1 12x4+0+0;", "5ab2185af28d4da5e70da572"],
        ["output scale", ["-filter", "point", "-define", "distort:scale=2", "-distort", "DePolar", "0"], "6x4 6x4+0+0;", "10f55e20ef7010f9910aefa110df8f06ef6e30d82460cf5030f7ab27cfdb309faf08cf544ca8009faf304cf4a84ca8f45060cf00a84c536a00df8f1053bd6a536abd7020ef006a53"],
        ["reverse angles", ["-filter", "point", "-distort", "DePolar", "1,0,1.5,1,90,-90"], "3x2 3x2+0+0;", "23c8b400ffbf37ea7d9159f400bfbfa6ea4e"],
    ] as [string, string[], string, string][])(`honors %s with DePolar (retained=${retained})`, async (_name, options, geometry, pixels) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const result = await runMagickCli(["/in.ppm", "-virtual-pixel", "black", ...options, "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", "rgb:/out"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: geometry, stderr: "" });
        expect(Buffer.from(retained ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(pixels);
    });
}

it.each([
    ["1,0,1", "number of arguments"],
    ["1,0,1,1,0,360,1,1,1", "number of arguments"],
    ["-2", "Invalid Radius"],
    ["1,1", "Invalid Radius"],
    ["1,-1", "Invalid Radius"],
    ["0,0,0,0", "Invalid Radius"],
    ["NaN", "invalid list of numbers"],
])("rejects invalid DePolar coefficients %s and preserves the destination", async (coefficients, diagnostic) => {
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const original = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
        const files = new Map([["/in.ppm", input], ["/out", original]]);
        await fs.writeFile("/in.ppm", input);
        await fs.writeFile("/out", original);
        const result = await runMagickCli(["/in.ppm", operator, "DePolar", coefficients!, "rgb:/out"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(diagnostic);
        expect(retained ? await fs.readFile("/out") : files.get("/out")).toEqual(original);
    }
});
