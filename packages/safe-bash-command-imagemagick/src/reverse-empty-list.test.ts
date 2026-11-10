import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["public", "sync", "buffered", "retained"] as const) {
    it.each([
        { name: "empty", input: ["-reverse", "xc:yellow"], valid: false },
        { name: "populated", input: ["xc:red", "xc:blue", "-reverse", "xc:yellow"], valid: true },
        { name: "empty group", input: ["xc:red", "xc:lime", "xc:blue", "xc:white", "(", "-reverse", ")", "xc:yellow"], valid: false },
    ])(`${mode} reverse handles $name list before writing`, async ({ input, valid }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["out", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argumentValues = createCommandArguments([...input, "+append", "-depth", "8", "rgb:out"]);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { expect(chunk.byteLength).toBe(0); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argumentValues.args, files)
            : await runConvertCli(argumentValues.args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft("stderr" in result ? result.stderr : stderr)
            .toBe(valid ? "" : "magick: no images found for operation '-reverse'\n");
        expect(mode === "sync" || mode === "buffered" ? files.get("out") : await fs.readFile("/out"))
            .toEqual(valid ? Uint8Array.of(0, 0, 255, 255, 0, 0, 255, 255, 0) : keep);
    });
}
