import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAABCAIAAABsYngUAAAAIklEQVR4nGP4z8DwQYOV4T8D1wkRBob/croLvL29t2zZAgBmEgjpoGIlEgAAAABJRU5ErkJggg==", "base64"));
const palette = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC", "base64"));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["HSL", "HSB", "HSV"])(`${mode}: converts remapped %s pixels back to sRGB`, async space => {
        for (const width of [8, 256]) for (const dither of [["+dither"], ["-dither", "FloydSteinberg"], ["-dither", "Riemersma"]]) {
            const files = new Map([["in.png", input], ["palette.png", palette]]), fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const argv = ["in.png", "-resize", `${width}x1!`, ...dither, "-colorspace", space, "-remap", "palette.png", "-colorspace", "sRGB", "PNG64:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(Array.from(decodeImage(output).data16!)).toEqual(Array.from({ length: width }, () => [0, 0, 65535, 65535]).flat());
        }
    });
}

// Native ImageMagick compares the palette entries in the reference hue colorspace.
for (const retained of [false, true]) it.each(["HSL", "HSB"])(`retained=${retained}: keeps %s palette selection and metadata`, async space => {
    const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const prefix = ["(", "xc:red", "xc:blue", "+append", "-colorspace", space, "-write", "mpr:palette", "+delete", ")", "in.png", "+dither", "-colorspace", space, "-remap", "mpr:palette"];
    const context = retained ? { filesystem: fs, cwd: "/" } : files;
    const info = await runConvertCli([...prefix, "-format", "%[colorspace]", "info:"], context);
    expect(info.exitCode).toBe(0);
    expect(info.stdout.trim()).toBe(space);
    expect((await runConvertCli([...prefix, "-colorspace", "sRGB", "PNG64:out.png"], context)).exitCode).toBe(0);
    const output = retained ? await fs.readFile("/out.png") : files.get("out.png")!;
    expect(Array.from(decodeImage(output).data16!)).toEqual(Array.from({ length: 8 }, (_, i) => (i < 2 || i >= 6) ? [65535, 0, 0, 65535] : [0, 0, 65535, 65535]).flat());
});
