import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: page offsets distinguish an empty trim
// from retaining the center pixel, even though both outputs are 1x1.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const space of ["HSL", "HSB", "sRGB"]) {
        it.each([
            { background: "#ff1000", center: "#ff0010", fuzz: "5%", percent: false, empty: true },
            { background: "#803820", center: "#508020", fuzz: "10%", percent: false, empty: false },
            { background: "#803820", center: "#508020", fuzz: "10%", percent: true, empty: false },
            { background: "#ff1000", center: "#ff0010", fuzz: "0%", percent: false, empty: false },
        ])(`${mode} ${space}: $background / $center fuzz=$fuzz percent=$percent`, async test => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const argv = [`xc:${test.background}`, `xc:${test.center}`, `xc:${test.background}`, "+append",
                "-colorspace", space, "-fuzz", test.fuzz,
                ...(test.percent ? ["-define", "trim:percent-background=50"] : []),
                "-trim", "-format", "%wx%h|%g", "info:/out"];
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
            expect(new TextDecoder().decode(output)).toBe(test.empty ? "1x1|3x1-1-1" : "1x1|3x1+1+0");
            if (test.empty) expect(stderr).toContain("geometry does not contain image");
            else expect(stderr).toBe("");
        });
    }
    it(`${mode}: preserves the zero-fuzz HSL RGB round trip`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#ff1000", "xc:#ff0010", "xc:#ff1000", "+append", "-colorspace", "HSL", "-fuzz", "0%", "-trim", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect([...(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!)]).toEqual([255, 0, 16, 255]);
    });
}
