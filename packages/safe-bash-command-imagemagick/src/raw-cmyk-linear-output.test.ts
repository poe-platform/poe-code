import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: direct output quantizes linear RGB before ink conversion.
const cases = [
    { space: "RGB", depth: 8, explicit: false, ink: "bf6300a9" },
    { space: "scRGB", depth: 8, explicit: false, ink: "bf6300a9" },
    { space: "LinearGray", depth: 8, explicit: false, ink: "000000cd" },
    { space: "RGB", depth: 16, explicit: false, ink: "ca6a65350000a9a9" },
    { space: "LinearGray", depth: 16, explicit: false, ink: "000000000000cd3f" },
    { space: "RGB", depth: 8, explicit: true, ink: "ca6500a9" },
    { space: "LinearGray", depth: 8, explicit: true, ink: "000000cc" },
    { space: "RGB", depth: 16, explicit: true, ink: "ca6a65350000a9a9" },
    { space: "LinearGray", depth: 16, explicit: true, ink: "000000000000cd3f" },
    { space: "sRGB", depth: 8, explicit: false, ink: "ca6500a9" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const alpha of [false, true])
it.each(cases)(`${mode}, alpha=${alpha}: $space at $depth bits, explicit CMYK=$explicit`, async ({ space, depth, explicit, ink }) => {
    // Cross the stored raw writer's 512-pixel chunk boundary.
    const width = mode === "command" ? 513 : 1;
    const args = ["-size", `${width}x1`, `xc:#123456${alpha ? "80" : ""}`, "-colorspace", space,
        ...(explicit ? ["-colorspace", "CMYK"] : []), "-depth", String(depth), "-endian", "MSB", `${alpha ? "cmyka" : "cmyk"}:-`];
    const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe((ink + (alpha ? "80".repeat(depth / 8) : "")).repeat(width));
});
