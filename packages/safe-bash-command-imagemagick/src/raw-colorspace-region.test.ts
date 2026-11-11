import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: regions match write masks during implicit RGB export.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const height of [1, 257])
for (const selection of ["active", "cleared", "none"] as const)
it.each([
    { space: "HSL", masked: "19559395af59", unmasked: "1955931c5896" },
    { space: "Lab", masked: "1f56935f8359", unmasked: "1f56931e5996" },
])(`${mode}, ${height} rows, ${selection} region: $space`, async ({ space, masked, unmasked }) => {
    const files = new Map([
        ["/in.ppm", Buffer.concat([Buffer.from(`P6\n2 ${height}\n255\n`), Buffer.from("1956931c5996".repeat(height), "hex")])],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.ppm", "-colorspace", space,
        ...(selection === "none" ? [] : ["-region", `1x${height}+0+0`]),
        ...(selection === "cleared" ? ["+region"] : []), "-depth", "8", "rgb:-"];
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
    expect(Buffer.from(bytes).toString("hex")).toBe((selection === "active" ? masked : unmasked).repeat(height));
});
