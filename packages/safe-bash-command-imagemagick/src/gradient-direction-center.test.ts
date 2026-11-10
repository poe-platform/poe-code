import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        "direction=Center",
        "direction=center",
        "direction=SouthEast",
        "vector=0,0 3,2",
    ])(`draws the native diagonal gradient in ${mode}: %s`, async (define) => {
        // ImageMagick 7.1.2-35 Q16-HDRI, 4x3 gray bytes in row order.
        const expected = "003b76b127629dd84e89c4ff";
        const fs = new MemoryFileSystem();
        const argv = ["-size", "4x3", "-define", `gradient:${define}`, "gradient:black-white", "-depth", "8", "gray:-"];
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
