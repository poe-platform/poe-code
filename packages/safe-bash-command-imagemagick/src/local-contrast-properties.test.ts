import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const input = Uint8Array.from(Buffer.concat([
    Buffer.from("P6\n7 5\n255\n"),
    Buffer.from(Uint8Array.from({ length: 105 }, (_, i) => (i * 41 + 51) % 256))
]));

for (const mode of ["public", "buffered", "sync", "mogrify"] as const) {
    it.each([
        [[], ["-set", "option:settings", "10x20"], "%[option:settings]"],
        [[], [], "%[fx:w+3]x20"],
        [["-resize", "14x10!"], [], "%[fx:w-4]x%[fx:h*2]"]
    ])(`expands local-contrast geometry against the current image via ${mode}: %j %j %s`, async (before, settings, geometry) => {
        const files = new Map([["/i.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/i.ppm", input);
        const options = [...before, ...settings, "-local-contrast", geometry, "-depth", "8"];
        const args = ["/i.ppm", ...options, "/o.ppm"];
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : mode === "mogrify" ? await runMogrifyCli([...options, "/i.ppm"], files)
                : await runConvertCli(args, files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = decodeImage(mode === "public" ? await fs.readFile("/o.ppm") : files.get(mode === "mogrify" ? "/i.ppm" : "/o.ppm")!);
        const literalFiles = new Map([["/i.ppm", input]]);
        expect(runConvertCliSync(["/i.ppm", ...before, "-local-contrast", "10x20", "-depth", "8", "/o.ppm"], literalFiles).exitCode).toBe(0);
        expect(output.data).toEqual(decodeImage(literalFiles.get("/o.ppm")!).data);
        // ImageMagick 7.1.2-35 Q16-HDRI: the first two RGB pixels are 3d6ea0d1ff00.
        if (!before.length) expect([...output.data.slice(0, 8)]).toEqual([61, 110, 160, 255, 209, 255, 0, 255]);
    });
}

it.each(["retained", "buffered", "sync", "mogrify"])("preserves output when expanded local-contrast geometry is invalid via %s", async mode => {
    const files = new Map([["/i.ppm", input], ["/o.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/i.ppm", input);
    await fs.writeFile("/o.ppm", input);
    const options = ["-set", "option:settings", "bad", "-local-contrast", "%[option:settings]"];
    const args = ["/i.ppm", ...options, "/o.ppm"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : mode === "mogrify" ? await runMogrifyCli([...options, "/i.ppm"], files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid local contrast geometry");
    expect(mode === "retained" ? await fs.readFile("/o.ppm") : files.get(mode === "mogrify" ? "/i.ppm" : "/o.ppm")).toEqual(input);
});
