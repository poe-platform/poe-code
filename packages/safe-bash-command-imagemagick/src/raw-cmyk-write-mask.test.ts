import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: implicit CMYK conversion preserves protected RGB samples as CMY, with zero K.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const height of [1, 257])
it.each([
    { name: "unrestricted", protection: [], expected: "d46a006ccf680069" },
    { name: "region", protection: ["-region", `1x${height}+0+0`], expected: "d46a006c1c599600" },
    { name: "cleared region", protection: ["-region", `1x${height}+0+0`, "+region"], expected: "d46a006ccf680069" },
    { name: "write mask", protection: ["-write-mask", "mpr:mask"], expected: "d46a006c1c599600" },
    { name: "cleared write mask", protection: ["-write-mask", "mpr:mask", "+write-mask"], expected: "d46a006ccf680069" },
])(`${mode}, ${height} rows: raw CMYK with $name`, async ({ protection, expected }) => {
    const files = new Map([
        ["/in.ppm", Buffer.concat([Buffer.from(`P6\n2 ${height}\n255\n`), Buffer.from("1956931c5996".repeat(height), "hex")])],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["(", "-size", `2x${height}`, "xc:white", "-fill", "black", "-draw", `rectangle 0,0 0,${height - 1}`,
        "-write", "mpr:mask", "+delete", ")", "/in.ppm", ...protection, "-depth", "8", "cmyk:-"];
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected.repeat(height));
});
