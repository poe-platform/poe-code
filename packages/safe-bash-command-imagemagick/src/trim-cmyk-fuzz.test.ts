import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const percent of [false, true]) {
        it.each([
            { space: "CMYK", fuzz: "20%", hex: "d02020ff", geometry: "1x1|3x1+1+0", bounds: "1x1+1+0|1,0 2,1", warning: "" },
            { space: "CMYK", fuzz: "0%", hex: "d02020ff", geometry: "1x1|3x1+1+0", bounds: "1x1+1+0|1,0 2,1", warning: "" },
            { space: "sRGB", fuzz: "20%", hex: "ffffff00", geometry: "1x1|3x1-1-1", bounds: "0x0+3+1|3,1 3,1", warning: "magick: geometry does not contain image\n" },
        ])(`${mode}, percent=${percent}: $space trim at $fuzz`, async test => {
            for (const output of test.space === "CMYK" ? ["rgba", "geometry", "bounds"] : ["rgba", "geometry"]) {
                const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/out", files.get("/out")!);
                const argv = ["xc:#803820", "xc:#d02020", "xc:#803820", "+append", "-colorspace", test.space,
                    "-fuzz", test.fuzz, ...(percent ? ["-define", "trim:percent-background=50"] : []),
                    ...(output === "bounds" ? ["-format", "%@|%[bounding-box]", "info:/out"] : ["-trim", ...(output === "rgba"
                        ? ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"] : ["-format", "%wx%h|%g", "info:/out"])])];
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
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(output === "rgba" ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes)).toBe(
                    output === "rgba" ? test.hex : output === "bounds" ? test.bounds : test.geometry);
                expect(stderr).toBe(output === "bounds" ? test.warning.repeat(2) : test.warning);
            }
        });
    }
}
