import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8.
const cases: { space: string; operation: string[]; hex: string; size?: string }[] = [
    { space: "HSL", operation: ["-thumbnail", "1x1"], hex: "258b5790" },
    { space: "HSL", operation: ["-resize", "1x1"], hex: "258b5790" },
    { space: "HSL", operation: ["-scale", "1x1"], hex: "258b5790" },
    { space: "HSL", operation: ["-filter", "point", "-resize", "1x1"], hex: "a0403060" },
    { space: "Lab", operation: ["-resize", "1x1"], hex: "60406690" },
    { space: "HWB", operation: ["-scale", "1x1"], hex: "258b5790" },
    { space: "XYZ", operation: ["-resize", "1x1"], hex: "64406d90" },
    { space: "HSL", operation: [], hex: "204080c0a0403060" },
    { space: "sRGB", operation: ["-thumbnail", "1x1"], hex: "4b406590" },
    { space: "sRGB", operation: ["-filter", "point", "-resize", "1x1"], hex: "a0403060" },
];

// Sampling must copy every working pixel, including alpha, before conversion.
for (const space of ["HSL", "Lab", "XYZ", "sRGB"]) cases.push({
    space, operation: ["-sample", "200%"],
    hex: "204080c0204080c0a0403060a0403060204080c0204080c0a0403060a0403060",
}, {
    space, size: "513x1", operation: ["-sample", "200%"],
    hex: ("204080c0".repeat(1026) + "a0403060".repeat(1026)).repeat(2),
});

// Cross both output chunks and source read chunks while retaining each color block.
for (const space of ["HSL", "Lab", "HWB", "XYZ"]) cases.push({
    space, size: "513x2", operation: ["-filter", "point", "-resize", "1026x1!"],
    hex: "204080c0".repeat(513) + "a0403060".repeat(513),
}, {
    space, size: "513x2", operation: ["-scale", "2x1!"], hex: "204080c0a0403060",
});

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: resizes $space working samples with $operation (size=$size)`, async ({ space, operation, hex, size }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [...(size ? ["-size", size] : []), "xc:#204080c0", "xc:#a0403060", "+append", "-colorspace", space,
        ...operation, "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
    const stdout: number[] = [];
    let stderr = "";
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
