import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7 Q16-HDRI, with MAGICK_THREAD_LIMIT=1.
for (const execution of ["sync", "buffered", "retained", "command"]) {
    it.each([
        { define: "direction=West", hex: "ffaa5555ffaa5500ffaa5500" },
        { define: "direction=NorthWest", hex: "ffc4894ed89d6227b1763b3b" },
        { define: "angle=22.5", hex: "9dbedeff4f6f90b000004162" },
        { define: "vector=3,0 0,0", hex: "ffaa5555ffaa5500ffaa5500" },
        { define: "direction=East", hex: "0055aaff0055aaff0055aaff" },
        { define: "angle=45", hex: "6699ccff336699cc00336699" }
    ])(`matches gradient:$define start pixel (${execution})`, async ({ define, hex }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["-size", "4x3", "-define", `gradient:${define}`, "gradient:black-white", "-depth", "8", "gray:-"];
        let bytes: Uint8Array;
        if (execution === "command") {
            const chunks: Buffer[] = [];
            let stderr = "";
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr += Buffer.from(chunk).toString(); } }, fs: filesystem
            });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            bytes = Buffer.concat(chunks);
        } else {
            const result = execution === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, execution === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = result.stdoutBytes!;
        }
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
