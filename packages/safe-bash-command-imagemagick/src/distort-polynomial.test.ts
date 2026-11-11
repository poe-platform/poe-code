import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

import fixtures from "./distort-polynomial-fixtures.json" with { type: "json" };

// Native ImageMagick Q16-HDRI reference pixels.
const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n255 255 0 0 255 255 255 0 255\n");
const keep = new TextEncoder().encode("KEEP");
for (const mode of ["command", "sync"] as const) {
    async function run(method: string, points: string, output = "rgb:-", filter = "point") {
        const files = new Map([["/in.ppm", input], ["/out.rgb", keep]]), fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(path, data);
        const args = ["/in.ppm", "-virtual-pixel", "black", "-filter", filter, "-distort", method, points,
            "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", output];
        let stdout = "", stderr = "";
        let exitCode: number;
        if (mode === "sync") {
            const result = runConvertCliSync(args, files);
            exitCode = result.exitCode;
            stdout = Buffer.from(result.stdout).toString("hex") + (result.stdoutBytes ? Buffer.from(result.stdoutBytes).toString("hex") : "");
            stderr = result.stderr;
        } else {
            const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
            exitCode = result.exitCode;
        }
        return { exitCode, stdout, stderr, output: mode === "sync" ? files.get("/out.rgb") : await fs.readFile("/out.rgb") };
    }
    it.each([
        ["Polynomial", "2 0,0 0,0 1,0 1,0 2,0 2,0 0,1 0,1 1,1 2,1 0,2 0,2", "df0000609f00009f609f9f00dfdf00dfff20"],
        ["Polynomial", "1 0,0 1,0 2,0 3,0 0,1 1,1", "000000ff000000ff00000000ffff0000ffff"],
        ["AffineProjection", "1,0,0,1,1,0", "000000ff000000ff00000000ffff0000ffff"]
    ])(`${mode}: matches native %s %s`, async (method, points, pixels) => {
        const result = await run(method, points);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(Buffer.from("3x2 3x2+0+0;").toString("hex") + pixels);
    });
    it.each(fixtures)(`${mode}: fits all points for $points with $filter`, async ({ points, filter, pixels }) => {
        const result = await run("Polynomial", points, "rgb:-", filter);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(Buffer.from("3x2 3x2+0+0;").toString("hex") + pixels);
    });
    it.each([
        ["1 0,0 0,0 1,0 1,0 0,1 0,1 2", "at least 3"],
        ["1 0,0 0,0 NaN,0 1,0 0,1 0,1", "invalid list of numbers"],
        ["0", "Invalid order"], ["2.5", "Invalid order"], ["6", "Invalid order"],
        ["1", "at least 3"], ["1.5", "at least 4"], ["2 0,0 0,0", "at least 6"],
        ["1 0,0 0,0 1,0 1,0 2,0 2,0", "Unsolvable Matrix"]
    ])(`${mode}: preserves destination for %s`, async (points, diagnostic) => {
        const result = await run("Polynomial", points, "/out.rgb");
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(diagnostic);
        expect(result.output).toEqual(keep);
    });
}
