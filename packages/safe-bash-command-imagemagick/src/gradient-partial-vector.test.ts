import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { vector: "1,0", expected: "00003b76b10027629dd8144e89c4ff" },
        { vector: "1,0 4,2", expected: "00003b76b10027629dd8144e89c4ff" },
        { vector: "1 0 3", expected: "00004080bf004080bfff4080bfffff" },
        { vector: "1,0 3,2", expected: "00004080bf004080bfff4080bfffff" },
        { vector: "1,0 3,0 5", expected: "000080ffff000080ffff000080ffff" },
        { vector: "1,0 3,0", expected: "000080ffff000080ffff000080ffff" },
    ])(`draws the complete raster for vector=$vector (${mode})`, async ({ vector, expected }) => {
        // ImageMagick 7.1.2-35 Q16-HDRI, 5x3 gray bytes in row order.
        const fs = new MemoryFileSystem();
        const argv = ["-size", "5x3", "-define", `gradient:vector=${vector}`, "gradient:black-white", "-depth", "8", "gray:-"];
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
