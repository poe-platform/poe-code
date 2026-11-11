import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI retains the region mask without adding RGBA samples.
for (const mode of ["command", "buffered", "sync", "retained"]) {
    for (const operation of [["-flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "flatten"], ["-layers", "mosaic"]]) {
        it.each(["active", "cleared", "absent"])(`${mode}: ${operation.join(" ")} with %s region`, async region => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["-size", "5x4", "xc:steelblue",
                ...(region === "absent" ? [] : ["-region", "3x2+1+1"]), ...operation,
                ...(region === "cleared" ? ["+region"] : []),
                "-depth", "8", "-write", "rgba:/pixels", "-format", "%[channels]", "-write", "info:/channels",
                "-separate", "-format", "%n;", "info:/separated"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            for (const [path, expected] of [
                ["/channels", new TextEncoder().encode(region === "active" ? "srgba 5.0" : "srgba 4.0")],
                ["/pixels", Uint8Array.from(Array.from({ length: 20 }, () => [70, 130, 180, 255]).flat())],
                ["/separated", new TextEncoder().encode("4;4;4;4;")]
            ] as const) {
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
                expect(bytes).toEqual(expected);
            }
        });
    }
}
