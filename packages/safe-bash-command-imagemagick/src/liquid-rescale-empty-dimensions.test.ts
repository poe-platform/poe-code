import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for the issue's 5x4 PPM.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([["x", "1x1"], ["0x0", "1x1"], ["x!", "5x4"], ["x3", "4x3"]] as const)(
        `resolves liquid-rescale geometry %s (${mode})`, async (geometry, shape) => {
            const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
            const files = new Map([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
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
            expect(result.exitCode).toBe(0);
            const output = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(`${shape},${shape}+0+0,DirectClass sRGB `);
        }
    );
}
