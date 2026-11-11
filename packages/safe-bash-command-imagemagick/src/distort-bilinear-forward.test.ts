import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n255 255 0 0 255 255 255 0 255\n");
const trapezoid = "0,0 0,0 2,0 2,0 0,1 0,1 2,1 3,1";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    async function run(method: string, points: string, operator = "-distort") {
        const sentinel = new TextEncoder().encode("keep destination");
        const files = new Map([["/in.ppm", input], ["/out.rgb", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/out.rgb", sentinel);
        const args = ["/in.ppm", "-virtual-pixel", "black", "-filter", "point", operator, method, points,
            "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", "rgb:/out.rgb"];
        let result;
        if (mode === "command") {
            let stdout = "", stderr = "";
            const execution = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            result = { exitCode: execution.exitCode, stdout, stderr };
        } else result = mode === "sync" ? runConvertCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb")!;
        return { ...result, output };
    }

    // ImageMagick 7.1.2-35 Q16-HDRI reference bytes, using six labeled source pixels.
    it.each([
        ["BilinearForward", trapezoid, "e600004db300008080c8c800a4ff5b12ffed"],
        ["BilinearForward", "0,0 1,0 2,0 3,0 0,1 1,1 2,1 3,1", "000000ff000000ff00000000ffff0000ffff"],
        ["BilinearForward", "0,0 0,0 2,0 2,0 0,1 0,1 2,1 3,2", "d5000028a40000328acda40080bf4016b57f"],
        ["BilinearForward", trapezoid + " 1,0.5 1.5,0.5", "db000057a800008a75c1c100abff541affe6"],
        ["BilinearForward", "0,0 1,0", "000000ff000000ff00000000ffff0000ffff"],
        ["AffineProjection", "1,0,0,1,1,0", "000000ff000000ff00000000ffff0000ffff"],
    ])(`matches native %s %s via ${mode}`, async (method, points, expected) => {
        const result = await run(method!, points!);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("3x2 3x2+0+0;");
        expect(Buffer.from(result.output).toString("hex")).toBe(expected);
        if (points === trapezoid) expect(Buffer.from(result.output).toString("hex"))
            .not.toBe("ea000040bf00006a95bfbf00bfff4040ffbf"); // BilinearReverse reference.
    });

    it(`retains the input bounds for +distort BilinearForward via ${mode}`, async () => {
        const result = await run("BilinearForward", trapezoid, "+distort");
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("3x2 3x2+0+0;");
        expect(Buffer.from(result.output).toString("hex")).toBe("e600004db300008080c8c800a4ff5b12ffed");
    });

    it.each([
        ["0,0 0,0 1,0 1,0 2,0 2,0 3,0 3,0", "Unsolvable Matrix"],
        [trapezoid + " 5", "point pairs"],
        ["0,0 0,0 2,0 2,0 0,1 0,1 2,1 3", "point pairs"],
        [trapezoid + " NaN", "invalid list of numbers"],
    ])(`rejects invalid forward control points %s via ${mode}`, async (points, diagnostic) => {
        const result = await run("BilinearForward", points!);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(diagnostic);
        expect(new TextDecoder().decode(result.output)).toBe("keep destination");
    });
}
