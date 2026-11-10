import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 with LQR: comma geometry needs ! and keeps the input dimensions.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        ["4,3!", 0, "5x4,5x4+0+0,DirectClass sRGB "],
        ["4,3", 1, "KEEP"],
        ["4x3!", 0, "4x3,4x3+0+0,DirectClass sRGB "],
    ] as const)(`handles liquid-rescale geometry %s (${mode})`, async (geometry, exitCode, expected) => {
        const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
        const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", "-liquid-rescale", geometry, "-format", "%wx%h,%Wx%H%X%Y,%r", "info:/out"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(exitCode);
        const output = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString()).toBe(expected);
    });
}
