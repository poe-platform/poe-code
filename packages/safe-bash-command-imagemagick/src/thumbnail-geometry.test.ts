import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Text captured from ImageMagick 7.1.2-35 Q16-HDRI before encoding the image.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["-set", "option:dims", "2x1!", "-thumbnail", "2x1!"], format: "%wx%h %g", expected: "2x1 0x0+0+0" },
        { options: ["-repage", "8x6+2-1", "-thumbnail", "2x2!"], format: "%wx%h %g %X %Y", expected: "2x2 0x0+0+0 +0 +0" },
        { options: ["-set", "option:dims", "2x1!", "-thumbnail", "3:2"], format: "%wx%h %g", expected: "4x3 0x0+0+0" },
        { options: ["-set", "option:dims", "2x1!", "-resize", "2x1!"], format: "%wx%h %g", expected: "2x1 2x1+0+0" },
        { options: ["-repage", "8x6+2-1", "-resize", "2x2!"], format: "%wx%h %g %X %Y", expected: "2x2 4x4+1-1 +1 -1" },
    ])(`${mode} matches native page geometry for $options`, async ({ options, format, expected }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n4 3\n255\n"),
            ...Array.from({ length: 36 }, (_, i) => i * 7),
        ]);
        const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argumentValues = createCommandArguments(["/in.ppm", ...options, "-format", format, "info:/out"]);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
            : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
