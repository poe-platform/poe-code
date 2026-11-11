import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n255 255 0  0 255 255  255 0 255\n");
const keep = new TextEncoder().encode("KEEP");

// ImageMagick 7.1.2-35 Q16-HDRI, point filter and depth-8 RGB output.
const cases: { method: string; geometry: string; page: string; pixels: string; invalid?: boolean; options?: string[]; format?: string }[] = [
    { method: "Resize", geometry: "6x4", page: "6x4 0x0+0+0;", pixels: "ff0000bf400040bf0000bf400040bf0000ffff4000bf701040cf3010bf703040cf4000ffffbf00bfcf3040ef8f30bfcf8f40efbf00ffffff00bfff4040ffbf40bfffbf40ffff00ff" },
    { method: "Resize", geometry: "2x2!", page: "2x2 0x0+0+0;", pixels: "bf40000040bfbfff40bf40ff" },
    { method: "Resize", geometry: "200%", page: "6x4 0x0+0+0;", pixels: "ff0000bf400040bf0000bf400040bf0000ffff4000bf701040cf3010bf703040cf4000ffffbf00bfcf3040ef8f30bfcf8f40efbf00ffffff00bfff4040ffbf40bfffbf40ffff00ff" },
    { method: "Resize", geometry: "2x2", page: "2x1 0x0+0+0;", pixels: "bf9f206040df" },
    { method: "Resize", geometry: "6x4>", page: "3x2 0x0+0+0;", pixels: "ff000000ff000000ffffff0000ffffff00ff" },
    { method: "Resize", geometry: "2x2!", options: ["+filter"], page: "2x2 0x0+0+0;", pixels: "9b6e00055fa3a1fa5b9164ff" },
    { method: "Resize", geometry: "3x2", options: ["+filter"], page: "3x2 0x0+0+0;", pixels: "f7190000e7181108eef7ee1118ffe7e608ff" },
    { method: "Resize", geometry: "2x2!", options: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel", "+filter"], format: "rgba", page: "2x2 0x0+0+0;", pixels: "9b6e0080055fa380a1fa5b809164ff80" },
    { method: "Resize", geometry: "%[option:target]", options: ["-set", "option:target", "2x2!"], page: "2x2 0x0+0+0;", pixels: "bf40000040bfbfff40bf40ff" },
    { method: "Resize", geometry: "6,4", page: "", pixels: "4b454550", invalid: true },
    { method: "AffineProjection", geometry: "1,0,0,1,1,0", page: "3x2 3x2+0+0;", pixels: "000000ff000000ff00000000ffff0000ffff" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) for (const operator of ["-distort", "+distort"]) {
    it.each(cases.filter(test => operator === "-distort" || test.method === "Resize"))(`matches native ${operator} $method $geometry via ${mode} with $options`, async ({ method, geometry, page, pixels, invalid, options = [], format = "rgb" }) => {
        const files = new Map([["/in.ppm", input], ["/out.raw", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/out.raw", keep);
        const args = ["/in.ppm", "-virtual-pixel", "black", "-filter", "point", ...options, operator, method, geometry,
            "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", `${format}:/out.raw`];
        let stdout = "", stderr = "", exitCode: number;
        if (mode === "command") {
            const arguments_ = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: arguments_.args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            ({ stdout, stderr, exitCode } = result);
        }
        expect(exitCode, stderr).toBe(invalid ? 1 : 0);
        if (invalid) expect(stderr).toContain("invalid geometry");
        else expect(stderr).toBe("");
        expect(stdout).toBe(page);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixels);
    });
}
