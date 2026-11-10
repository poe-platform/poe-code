import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI leaves the rectangle at its default
// dimensions when a width has a second decimal point, before reading the height.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const geometry of ["1..2x1", "1.2.3x1", "1.2x1"]) {
        it.each(["-splice", "-chop"])(`${mode}: %s resolves rectangle width ${geometry}`, async operation => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", keep]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", keep);
            const argv = ["-size", "3x2", "xc:red", operation, geometry, "-format", "%wx%h", "info:/out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const fallback = geometry !== "1.2x1";
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(operation === "-splice" ? fallback ? "6x4" : "4x3" : fallback ? "3x2" : "2x1");
            expect("stderr" in result ? result.stderr : stderr).toBe(operation === "-chop" && fallback
                ? `magick: geometry does not contain image '${geometry}'\n` : "");
        });
    }
}
