import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: negative sigma behaves like zero blur.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["info", "rgba"] as const) {
        it.each(["-1", "-0.5", "-.5", "-1e-1", "0"])(
            `preserves unblurred shadow pixels and offsets at sigma %s (${mode}, ${format})`, async sigma => {
                const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
                const argv = ["-size", "3x2", "xc:#507ba080", "-background", "#d05028", "-shadow", `80x${sigma}+1+2`,
                    "-format", "%wx%h %g %[fx:p{0,0}.a]", ...(format === "rgba" ? ["-depth", "8"] : []), `${format}:/out`];
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
                if (format === "info") expect(new TextDecoder().decode(output)).toBe("3x2 4x4+1+2 0.401569");
                else expect(output).toEqual(Uint8Array.from(Array.from({ length: 6 }, () => [208, 80, 40, 102]).flat()));
            }
        );
    }
}
