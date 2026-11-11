import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reports Grayscale immediately after conversion,
// but recomputes GrayscaleAlpha after -unique-colors without dropping alpha.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const alpha of ["80", "ff"])
for (const unique of [false, true])
for (const output of ["info", "rgba"])
it(`${mode}: Gray conversion with alpha ${alpha}, unique=${unique}, ${output}`, async () => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = [`xc:#123456${alpha}`, "-colorspace", "Gray", ...(unique ? ["-unique-colors"] : []),
        ...(output === "info" ? ["-format", "%[type]|%[channels]|%[opaque]", "info:out"] : ["-depth", "8", "rgba:out"])];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
    expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(output === "info"
        ? `${unique ? "GrayscaleAlpha" : "Grayscale"}|graya 2.0|${alpha === "ff" ? "True" : "False"}`
        : `2f2f2f${alpha}`);
});
