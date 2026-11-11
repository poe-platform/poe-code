import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const percent of [false, true]) {
        it.each(["0%", "10%", "20%"].map(fuzz => ({
            space: "HWB", fuzz, hex: "454542ff", geometry: "1x1|3x1+1+0",
            bounds: percent ? "1x1+1+0|1,0 2,1" : "1x2+1+0|1,0 2,2", warning: "",
        })))(`${mode}, percent=${percent}: $space trim at $fuzz`, async test => {
            for (const output of ["rgba", "geometry", "bounds"]) {
                const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/out", files.get("/out")!);
                const argv = ["xc:#444444", "xc:#454542", "xc:#444444", "+append", "-colorspace", test.space,
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
                expect(stderr).toBe(test.warning);
            }
        });
    }
}
