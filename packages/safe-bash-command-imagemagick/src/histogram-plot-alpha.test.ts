import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains an opaque alpha channel in RGBA plots.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { format: "rgba", pixel: [128, 64, 32, 128], expected: "srgba 4.0|16383.8|1", hasAlpha: true },
        { format: "rgba", pixel: [128, 64, 32, 255], expected: "srgba 4.0|16383.8|1", hasAlpha: true },
        { format: "rgb", pixel: [128, 64, 32], expected: "srgb  3.0|0|0", hasAlpha: false }
    ])(`preserves histogram plot channels for $pixel (${mode})`, async ({ format, pixel, expected, hasAlpha }) => {
        const bytes = new Uint8Array(pixel), files = new Map([["/in.bin", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.bin", bytes);
        const run = async (args: string[]) => {
            if (mode !== "command") return mode === "sync" ? runConvertCliSync(args, files)
                : runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
                stderr: { async write(chunk) { stderr.push(chunk.slice()); } }
            });
            return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
        };
        const source = ["-size", "1x1", "-depth", "8", `${format}:/in.bin`, "-density", "8x4"];
        const properties = ["-format", "%[channels]|%[mean]|%[fx:p{0,0}.a]"];
        expect(await run([...source, ...properties, "histogram:info:"]))
            .toMatchObject({ exitCode: 0, stderr: "", stdout: expected });
        expect(await run([...source, "histogram:/plot.miff"]))
            .toMatchObject({ exitCode: 0, stderr: "", stdout: "" });
        const plot = decodeImage(mode === "sync" || mode === "buffered" ? files.get("/plot.miff")! : await filesystem.readFile("/plot.miff"));
        expect([plot.width, plot.height, plot.hasAlpha, plot.channels]).toEqual([8, 4, hasAlpha, hasAlpha ? 4 : 3]);
        expect([...plot.data]).toEqual(Array.from({ length: 32 }, () => [0, 0, 0, 255]).flat());
        expect(await run(["/plot.miff", ...properties, "info:"]))
            .toMatchObject({ exitCode: 0, stderr: "", stdout: expected });
    });
}
