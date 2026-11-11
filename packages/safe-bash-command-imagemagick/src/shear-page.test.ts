import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Page geometries verified against native ImageMagick 7, including unchanged raster size.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["20x15+3+2", "20x10", "9x6 9x6+3+2"],
        ["20x15-3-2", "20x10", "9x6 9x6-3-2"],
        ["20x15+3+2", "20x0", "9x5 9x5+3+2"],
        ["20x15+3+2", "0x10", "7x6 7x6+3+2"],
        ["20x15+3+2", "0.1x0", "7x5 7x5+3+2"],
        ["20x15+3+2", "0x0", "7x5 20x15+3+2"],
    ])(`preserves positioned canvas for %s sheared %s (${mode})`, async (page, angle, geometry) => {
        const input = await sharp(Uint8Array.from({ length: 7 * 5 * 3 }, (_, i) => i * 37 % 256), { raw: { width: 7, height: 5, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-repage", page, "-background", "#505050", "-shear", angle, "/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect((await runMagickCli(["identify", "-format", "%wx%h %g", "/output.png"], new Map([["/output.png", output]]))).stdout).toBe(geometry);
    });
}

// Live page dimensions differ from the dimensions assigned when reopening a PNG.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { page: ["-repage", "9x8+3-2"], angle: "15x0", reset: [], expected: "4x2 0x0+3-2 0,0,+3,-2" },
        { page: [], angle: "15x0", reset: [], expected: "4x2 0x0+0+0 0,0,+0,+0" },
        { page: ["-repage", "9x8+3-2"], angle: "0x0", reset: [], expected: "3x2 9x8+3-2 9,8,+3,-2" },
        { page: ["-repage", "9x8+3-2"], angle: "15x0", reset: ["+repage"], expected: "4x2 0x0+0+0 0,0,+0,+0" },
    ])(`reports live shear page dimensions: $expected (${mode})`, async ({ page, angle, reset, expected }) => {
        const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => (i + 1) * 10))]);
        const files = new Map([["/input.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.ppm", input);
        const args = ["/input.ppm", ...page, "-shear", angle, ...reset, "-format", "%wx%h %g %W,%H,%X,%Y", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
