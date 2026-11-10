import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["public", "sync", "buffered", "retained"] as const) {
    for (const operation of ["+delete", "-delete"]) {
        it.each(["empty", "group", "nonempty"])(`${mode} ${operation} handles a %s list before writing`, async scenario => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["out", keep]]), fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const argumentValues = createCommandArguments([
                ...(scenario === "group" ? ["xc:red", "xc:lime", "xc:blue", "xc:white", "("]
                    : scenario === "nonempty" ? ["xc:red", "xc:blue"] : []),
                operation, ...(operation === "-delete" ? ["0"] : []),
                ...(scenario === "group" ? [")"] : []),
                "xc:yellow", "+append", "-depth", "8", "rgb:out"
            ]);
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { expect(chunk.byteLength).toBe(0); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(argumentValues.args, files)
                : await runConvertCli(argumentValues.args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const valid = scenario === "nonempty";
            expect.soft(result.exitCode).toBe(valid ? 0 : 1);
            const diagnostic = "stderr" in result ? result.stderr : stderr;
            if (valid) expect.soft(diagnostic).toBe("");
            else expect.soft(diagnostic).toContain(`no images found for operation '${operation}'`);
            const expected = operation === "+delete" ? [255, 0, 0, 255, 255, 0] : [0, 0, 255, 255, 255, 0];
            expect(mode === "sync" || mode === "buffered" ? files.get("out") : await fs.readFile("/out"))
                .toEqual(valid ? Uint8Array.from(expected) : keep);
        });
    }
}
