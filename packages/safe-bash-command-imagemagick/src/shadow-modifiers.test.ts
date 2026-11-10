import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const format of ["info", "rgba"] as const) {
        it.each(["(80x0+1+2)", "80x0+1+2#", "80x0#+1+2", "80x0+1+2@", "80x0+1+2"])(
            `preserves shadow geometry and pixels for %s (${mode}, ${format})`, async geometry => {
                const sentinel = new TextEncoder().encode("KEEP");
                const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/out", sentinel);
                const argv = ["-size", "3x2", "xc:#5080c080", "-background", "#d04020", "-shadow", geometry,
                    "-format", "%wx%h %g %[channels];", "-depth", "8", `${format}:/out`];
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
                if (format === "info") {
                    // ImageMagick 7.1.2-35 Q16-HDRI geometry and channel output.
                    expect(new TextDecoder().decode(output)).toBe("3x2 4x4+1+2 srgba 4.0;");
                } else {
                    // Zero blur preserves six pixels with background RGB and 80% of source alpha.
                    expect(output).toEqual(Uint8Array.from(Array.from({ length: 6 }, () => [208, 64, 32, 102]).flat()));
                }
            }
        );
    }
}
