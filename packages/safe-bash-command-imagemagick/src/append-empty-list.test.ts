import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["public", "sync", "buffered", "retained"] as const) {
    for (const operation of ["-append", "+append"]) {
        it.each(["empty", "deleted", "group", "single"])(`${mode} ${operation} handles a %s list before writing`, async scenario => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["out", keep]]), fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const input = ["-size", "2x1", "xc:#2060b080"];
            const argumentValues = createCommandArguments([
                ...(scenario === "deleted" ? ["xc:blue", "+delete"] : scenario === "group" ? ["xc:blue", "("] : []),
                ...(scenario === "single" ? [...input, operation] : [operation, ...input]),
                ...(scenario === "group" ? [")"] : []), "-depth", "8", "rgba:out"
            ]);
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { expect(chunk.byteLength).toBe(0); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(argumentValues.args, files)
                : await runConvertCli(argumentValues.args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            // Native ImageMagick rejects the empty current list, even if a later input follows.
            const valid = scenario === "single";
            expect.soft(result.exitCode).toBe(valid ? 0 : 1);
            const diagnostic = "stderr" in result ? result.stderr : stderr;
            if (valid) expect.soft(diagnostic).toBe("");
            else expect.soft(diagnostic).toContain(`no images found for operation '${operation}'`);
            expect(mode === "sync" || mode === "buffered" ? files.get("out") : await fs.readFile("/out"))
                .toEqual(valid ? Uint8Array.of(0x20, 0x60, 0xb0, 0x80, 0x20, 0x60, 0xb0, 0x80) : keep);
        });
    }
}
