import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7 Q16-HDRI, with MAGICK_THREAD_LIMIT=1.
for (const execution of ["sync", "buffered", "retained", "command"]) {
    it.each([
        { box: "3x", hex: "000000000000000000000000000000" },
        { box: "3X", hex: "000000000000000000000000000000" },
        { box: "3x0", hex: "000000000000000000000000000000" },
        { box: "3x1", hex: "004080000000000000000000000000" },
        { box: "3", hex: "004080000000408000000040800000" },
        { box: "3x+0+0", hex: "004080000000408000000040800000" }
    ])(`matches gradient bounding-box=$box height (${execution})`, async ({ box, hex }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["-size", "5x3", "-define", "gradient:direction=East", "-define", `gradient:bounding-box=${box}`, "gradient:black-white", "-depth", "8", "gray:-"];
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
