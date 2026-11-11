import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: implicit and explicit conversion round differently.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const height of [1, 257])
it.each([
    { space: "HSL", after: [], expected: "19559395af59" },
    { space: "HSL", after: ["-colorspace", "sRGB"], expected: "19569395af59" },
    { space: "HSL", after: ["+write-mask"], expected: "1955931c5896" },
    { space: "Lab", after: [], expected: "1f56935f8359" },
    { space: "Lab", after: ["-colorspace", "sRGB"], expected: "1956935f8359" },
    { space: "Lab", after: ["+write-mask"], expected: "1f56931e5996" },
])(`${mode}, ${height} rows: $space $after`, async ({ space, after, expected }) => {
    const files = new Map([
        ["/in.ppm", Buffer.concat([Buffer.from(`P6\n2 ${height}\n255\n`), Buffer.from("1956931c5996".repeat(height), "hex")])],
        ["/mask.pgm", Buffer.concat([Buffer.from(`P5\n2 ${height}\n255\n`), Buffer.from("00ff".repeat(height), "hex")])],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.ppm", "-colorspace", space, "-write-mask", "/mask.pgm", ...after, "-depth", "8", "rgb:-"];
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
