import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = [[248, 29, 162], [11, 75, 254], [92, 240, 126], [140, 38, 93]];
const input = new Uint8Array([...new TextEncoder().encode("P6\n4 2\n255\n"), ...[1, 2, 3, 0, 3, 1, 0, 2].flatMap(index => colors[index]!)]);

// Native ImageMagick 7.1.2-35 Q16-HDRI, including decoded RGBA16 PNG pixels.
const cases = [
    { args: ["xc:#4080c080", "-colorspace", "lUv", "-colorspace", "LUV", "-format", "%[colorspace]|%[fx:u.r] %[fx:u.g] %[fx:u.b] %[fx:u.a]", "info:/out"], text: "Luv|0.522121 0.306619 0.303279 0.501961" },
    { args: ["xc:black", "-colorspace", "Luv", "-colorspace", "sRGB", "PNG64:/out"], hex: "000000000000ffff", width: 1 },
    { args: ["xc:#4080c080", "-colorspace", "Luv", "PNG64:/out"], hex: "40458080c0bf8080", width: 1 },
    { args: ["xc:#4080c0", "-colorspace", "Luv", "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "0.522121 0.306619 0.303279" },
    { args: ["xc:#4080c0", "-colorspace", "Luv", "-format", "%[colorspace]", "info:/out"], text: "Luv" },
    { args: ["xc:#4080c0", "-colorspace", "Luv", "-colorspace", "sRGB", "PNG64:/out"], hex: "40458080c0bfffff", width: 1 },
    { args: ["/in.ppm", "-colorspace", "Luv", "-unique-colors", "-colorspace", "sRGB", "PNG64:/out"], hex: "0b2e4b4bfefdffff8c8e261e5d5cfffff8fc1cf8a2a0ffff5c5ef0f07e7cffff", width: 4 },
    { args: ["xc:#4080c0", "-colorspace", "Lab", "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "0.522121 0.500415 0.345117" },
    { args: ["xc:#4080c0", "-colorspace", "Lab", "-format", "%[colorspace]", "info:/out"], text: "CIELab" },
];
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches native Luv conversion and Lab controls (${mode}): $args`, async ({ args, text, hex, width }) => {
        const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (text !== undefined) expect(new TextDecoder().decode(output)).toBe(text);
        else {
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([width, 1]);
            expect(Array.from(image.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(hex);
        }
    });
}
