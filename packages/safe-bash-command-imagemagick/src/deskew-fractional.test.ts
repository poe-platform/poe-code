import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n16 8\n255\n"), Uint8Array.from({ length: 16 * 8 * 3 }, (_, i) => {
    const pixel = Math.floor(i / 3), x = pixel % 16, y = Math.floor(pixel / 16);
    return (y === 2 + Math.floor(x / 5) ? [38, 65, 100] : [230, 224, 218])[i % 3]!;
})]);

// Native ImageMagick 7.1.2-35 Q16-HDRI, interior pixel (8,5), RGBA16 MSB.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "default filter", options: ["-deskew", "40%"], expected: "2bb72f6c3484ffff", hash: "d24c6853b6328f317453323d9664bfaee2fe8d30f68ba612054b2782ded77f4f", geometry: "18x11 18x11-1-1 3.5763343749973515" },
        { name: "zero threshold", options: ["-deskew", "0"], expected: "4cf74af548f3ffff", hash: "cbbe022e0b1ffed73bf29bb44fe04013ee21551333e13783e6a1f200cb8b0ca5", geometry: "18x10 18x10-1-1 -0" },
        { name: "without deskew", options: [], expected: "4cf74af548f3ffff", hash: "fc00943f84e825406e7119191429ca3ccd4d91ceb8ef725e0625ca13c588b827", geometry: "16x8 16x8+0+0" },
        { name: "point filter", options: ["-filter", "point", "-deskew", "40%"], expected: "2e58319a3622ffff", hash: "03d4022e1a508b9412969dd385b1f2561834ddc2b704f479898e9aba3ce411d5", geometry: "18x11 18x11-1-1 3.5763343749973515" }
    ])(`${mode}: preserves fractional deskew samples with $name`, async ({ options, expected, hash, geometry }) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-background", "#3185b9", "-evaluate", "Divide", "3", ...options,
            "-depth", "16", "-endian", "MSB", "-write", "rgba:/full.rgba",
            "-format", options.length ? "%wx%h %g %[deskew:angle]" : "%wx%h %g", "-write", "info:/geometry",
            "+repage", "-crop", "1x1+8+5", "+repage", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB",
            "-write", "PNG64:/out.png", "rgba:/out.rgba"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const full = mode === "buffered" || mode === "sync" ? files.get("/full.rgba")! : await fs.readFile("/full.rgba");
        expect(createHash("sha256").update(full).digest("hex")).toBe(hash);
        const info = mode === "buffered" || mode === "sync" ? files.get("/geometry")! : await fs.readFile("/geometry");
        expect(new TextDecoder().decode(info)).toBe(geometry);
        const raw = mode === "buffered" || mode === "sync" ? files.get("/out.rgba")! : await fs.readFile("/out.rgba");
        expect(Buffer.from(raw).toString("hex")).toBe(expected);
        const png = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        const samples = decodeImage(png).data16!;
        expect([...samples]).toEqual(Array.from({ length: 4 }, (_, i) => Number.parseInt(expected.slice(i * 4, i * 4 + 4), 16)));
    });
}
