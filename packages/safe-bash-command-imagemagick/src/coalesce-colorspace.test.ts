import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: coalesce copies channels into the first canvas.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const operation of [["-coalesce"], ["-layers", "coalesce"]])
for (const output of ["metadata", "pixels"])
it.each([
    { first: "Gray", second: "sRGB", pixels: "5f5f5fcccccc" },
    { first: "CMYK", second: "sRGB", pixels: "336699337fbf" },
    { first: "sRGB", second: "CMYK", pixels: "336699005faf" },
    { first: "Gray", second: "Gray", pixels: "5f5f5f8c8c8c" },
    { first: "sRGB", second: "sRGB", pixels: "336699cc8040" },
    { first: "CMYK", second: "CMYK", pixels: "336699cc8040" },
])(`${mode} ${operation.join(" ")} ${output}: $first/$second`, async ({ first, second, pixels }) => {
    const argv = ["(", "-size", "2x1", "xc:#336699", "-colorspace", first, ")",
        "(", "-size", "1x1", "xc:#cc8040", "-colorspace", second, "-repage", "2x1+1+0", ")", ...operation,
        ...(output === "metadata" ? ["-format", "%[colorspace];", "info:"] : ["-delete", "0", "-colorspace", "sRGB", "-depth", "8", "rgb:-"])];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), chunks: Uint8Array[] = [];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(output === "metadata" ? mode === "command" ? Buffer.from(bytes).toString() : "stdout" in result ? result.stdout : "" : Buffer.from(bytes).toString("hex"))
        .toBe(output === "metadata" ? `${first};${first};` : pixels);
});
