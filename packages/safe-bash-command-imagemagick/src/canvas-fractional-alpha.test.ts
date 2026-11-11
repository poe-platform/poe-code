import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: retain alpha until output quantization.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const prefix of ["xc", "canvas"])
for (const output of ["16", "8", "text"])
it.each([
    ["0", "0000", "00", "0"],
    ["0.25", "4000", "40", "0.25"],
    ["0.5", "8000", "80", "0.5"],
    ["25%", "4000", "40", "0.25"],
    ["50%", "8000", "80", "0.5"],
    ["1", "ffff", "ff", "1"],
])(`${mode}: ${prefix} preserves alpha %s in ${output} output`, async (alpha, word, byte, text) => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = [`${prefix}:rgba(10,30,70,${alpha})`, ...(output === "text"
        ? ["-format", "%[pixel:u]", "info:"]
        : ["-depth", output, "-endian", "MSB", "rgba:raw"])];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    if (output === "text") expect("stdout" in result ? result.stdout : stdout).toBe(`srgba(10,30,70,${text})`);
    else {
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/raw") : files.get("raw")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(output === "16" ? `0a0a1e1e4646${word}` : `0a1e46${byte}`);
    }
});
