import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, seed 42, RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["bad", 1, "4b454550"],
        ["0x1", 0, "4a95dfffffff77ff"],
        ["1x1+30", 0, "4a93ddffffff70ff"],
    ] as const)(`${mode}: validates sketch geometry %s before replacing output`, async (geometry, exitCode, expected) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.raw", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out.raw", keep);
        const args = ["-seed", "42", "xc:#204060", "xc:#b06020", "+append", "-sketch", geometry, "-depth", "8", "rgba:/out.raw"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(exitCode);
        const error = "stderr" in result ? result.stderr : stderr;
        if (exitCode) expect.soft(error).toContain("invalid argument for option '-sketch'");
        else expect(error).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
