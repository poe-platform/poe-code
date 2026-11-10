import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["command", "sync"] as const) {
    async function run(args: string[]) {
        const fs = new MemoryFileSystem();
        const keep = new TextEncoder().encode("KEEP");
        await fs.writeFile("/out.png", keep);
        const files = new Map([["/out.png", keep]]);
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(mode === "sync" ? files.get("/out.png") : await fs.readFile("/out.png")).toEqual(keep);
        return { stdout, stderr, ...result };
    }

    // Native ImageMagick 7.1.2 rejects zero scales in every SRT argument form.
    for (const operator of ["-distort", "+distort"])
    it.each(["0,30", "-0,30", "0,0,0,30", "0,0,1,0,0", "0,0,0,1,0", "0,0,0,30,1,1", "0,0,0,1,0,1,1", "0,0,1,0,0,1,1"])(
        `${mode}: rejects ${operator} SRT %s without output`, async coefficients => {
            const result = await run(["-size", "3x2", "xc:red", "-filter", "point", "-virtual-pixel", "tile", operator, "SRT", coefficients, "-write", "/out.png", "-format", "%wx%h|%g", "info:-"]);
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.stderr).toContain("invalid argument for option ScaleRotateTranslate : 'Zero Scale Given'");
        }
    );

    it(`${mode}: rejects the long SRT method name on a single pixel`, async () => {
        const result = await run(["xc:red", "-distort", "ScaleRotateTranslate", "0,30", "-format", "%wx%h", "info:-"]);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Zero Scale Given");
    });

    it.each([
        ["1x1", "-distort", "0", "%wx%h", "1x1"],
        ["3x2", "-distort", "1,0", "%wx%h|%g", "3x2|3x2+0+0"],
        ["3x2", "+distort", "0,0,1,1,0", "%wx%h|%g", "5x4|5x4-1-1"],
        ["3x2", "-distort", "0,0,0", "%wx%h|%g", "3x2|3x2+0+0"],
        ["3x2", "-distort", "0,0,-1,1,0", "%wx%h|%g", "3x2|3x2+0+0"]
    ])(`${mode}: preserves valid %s %s SRT %s`, async (size, operator, coefficients, format, expected) => {
        const result = await run(["-size", size, "xc:red", "-filter", "point", "-virtual-pixel", "tile", operator, "SRT", coefficients, "-format", format, "info:-"]);
        expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
