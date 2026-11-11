import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        "direction=Center",
        "direction=center",
        "direction=SouthEast",
        "direction=None",
        "direction=none",
        "direction=Forget",
        "direction=forget",
        "direction=Undefined",
        "direction=undefined",
        "vector=0,0 4,2",
        undefined,
    ])(`draws the native gradient in ${mode}: %s`, async (define) => {
        // ImageMagick 7.1.2-35 Q16-HDRI, 5x3 gray bytes in row order.
        const expected = define === undefined ? "00000000008080808080ffffffffff" : "00336699cc1a4d80b3e6336699ccff";
        const fs = new MemoryFileSystem();
        const argv = ["-size", "5x3", ...(define === undefined ? [] : ["-define", `gradient:${define}`]), "gradient:black-white", "-depth", "8", "gray:-"];
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            expect(Buffer.concat(chunks).toString("hex")).toBe(expected);
        } else {
            const files = new Map<string, Uint8Array>();
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
        }
    });
}
