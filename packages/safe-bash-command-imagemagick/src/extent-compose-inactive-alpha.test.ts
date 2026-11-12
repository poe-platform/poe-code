import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: covered pixel followed by unchanged padding.
describe.each(["command", "sync", "buffered", "retained"] as const)("extent source alpha (%s)", mode => {
    it.each([
        { alpha: "Off", compose: "Copy", background: "none", expected: "4080c0ff00000000" },
        { alpha: "Off", compose: "DstOver", background: "none", expected: "4080c0ff00000000" },
        { alpha: "Off", compose: "Multiply", background: "#20402040", expected: "326896ff20402040" },
        { alpha: "Off", compose: "Xor", background: "#20402040", expected: "306090bf20402040" },
        { alpha: "Off", compose: "Over", background: "none", expected: "4080c0ff00000000" },
        { alpha: "On", compose: "Copy", background: "none", expected: "4080c08000000000" },
        { alpha: "Discrete", compose: "Multiply", background: "#20402040", expected: "2e607ea020402040" },
    ])("$alpha $compose on $background", async ({ alpha, compose, background, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argv = ["xc:#4080c080", "-alpha", alpha, "-background", background,
            "-compose", compose, "-extent", "2x1", "-depth", "8", "rgba:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
});
