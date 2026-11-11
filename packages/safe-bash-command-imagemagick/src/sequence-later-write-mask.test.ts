import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains a zero-valued mask from either input.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const operation of ["Mean", "Max"])
for (const masked of ["none", "first", "second"])
for (const clear of [false, true])
for (const output of ["rgba", "channels"]) {
    it(`retains sequence ${operation} mask: ${masked}, clear=${clear}, ${output}, ${mode}`, async () => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const argv = ["(", "xc:red", ...(masked === "first" ? ["-write-mask", "xc:white"] : []), ")",
            "(", "xc:blue", ...(masked === "second" ? ["-write-mask", "xc:white"] : []), ")",
            "-evaluate-sequence", operation, ...(clear ? ["+write-mask"] : []),
            ...(output === "rgba" ? ["-depth", "8", "rgba:out"] : ["-format", "%[channels]", "info:out"])];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        const retained = masked !== "none" && !clear;
        expect(Buffer.from(bytes).toString(output === "rgba" ? "hex" : "utf8")).toBe(output === "rgba"
            ? (operation === "Mean" ? "800080" : "ff00ff") + (retained ? "00" : "ff")
            : `srgb  ${retained ? 4 : 3}.0`);
    });
}
