import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = Array.from({ length: 30 }, () => [100, 120, 140]);
pixels[1] = [102, 120, 140];
pixels[14] = [26, 38, 54];
pixels[15] = [50, 100, 130];
pixels[20] = [69, 21, 90];
pixels[21] = [200, 230, 17];
const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...pixels.flat()]);
const cropped = "66788cff64788cff64788cff64788cff64788cff64788cff64788cff1a2636ff326482ff64788cff45155affc8e611ff";

// ImageMagick 7.1.2-35 Q16-HDRI: arithmetic keeps differences beyond white,
// below black, and below integer precision until an explicit clamp.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["info", "PNG32"] as const) {
        it.each([
            { operations: ["-evaluate", "add", "100%", "-trim", "-evaluate", "subtract", "100%"], geometry: "3x4 6x5+1+0", width: 3, height: 4, hex: cropped },
            { operations: ["-evaluate", "subtract", "30000", "-trim", "-evaluate", "add", "30000"], geometry: "3x4 6x5+1+0", width: 3, height: 4, hex: cropped },
            { operations: ["-evaluate", "multiply", "0.0001", "-trim", "-evaluate", "divide", "0.0001"], geometry: "3x4 6x5+1+0", width: 3, height: 4, hex: cropped },
            { operations: ["-evaluate", "add", "100%", "-clamp", "-trim", "-evaluate", "subtract", "100%"], geometry: "1x1 6x5-1-1", width: 1, height: 1, hex: "00000000" },
            { operations: ["-evaluate", "subtract", "30000", "-clamp", "-trim", "-evaluate", "add", "30000"], geometry: "2x2 6x5+2+2", width: 2, height: 2, hex: "757575ff757582ff757575ffc8e675ff" },
            { operations: ["-evaluate", "add", "100%", "-evaluate", "subtract", "100%"], geometry: "6x5 6x5+0+0", width: 6, height: 5, hex: Buffer.from(pixels.flatMap(pixel => [...pixel, 255])).toString("hex") },
        ])(`${mode} ${format}: trims working samples through $operations`, async test => {
            const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["/in.ppm", ...test.operations, "-format", "%wx%h %g", `${format}:/out`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "info") expect(new TextDecoder().decode(output)).toBe(test.geometry);
            else {
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([test.width, test.height]);
                expect(Buffer.from(image.data).toString("hex")).toBe(test.hex);
            }
        });
    }
}

for (const retained of [false, true]) {
    it.each([["add", "100%"], ["subtract", "30000"], ["multiply", "0.0001"]])(`reports working trim bounds for %s %s (retained=${retained})`, async (operation, value) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const result = await runMagickCli(["/in.ppm", "-evaluate", operation, value, "-format", "%@|%[bounding-box]", "info:-"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "3x4+1+0|1,0 4,4", stderr: "" });
    });

    it(`clears working pixels when trim produces the empty sentinel (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const result = await runMagickCli(["-size", "2x2", "xc:#123456", "-evaluate", "add", "100%", "-trim", "-evaluate", "subtract", "100%", "PNG32:/out"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toContain("geometry does not contain image");
        const image = decodeImage(retained ? await filesystem.readFile("/out") : files.get("/out")!);
        expect([image.width, image.height]).toEqual([1, 1]);
        expect([...image.data]).toEqual([0, 0, 0, 0]);
    });
}
