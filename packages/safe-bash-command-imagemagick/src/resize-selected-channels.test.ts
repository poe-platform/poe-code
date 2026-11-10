import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete raw RGBA8 output.
const cases = [
    { operation: "-thumbnail", channel: "R", hex: "35adcf80e2dcbac0" },
    { operation: "-resize", channel: "R", hex: "54adcf80dcdcbac0" },
    { operation: "-thumbnail", channel: "G", hex: "8b64cf80fed3bac0" },
    { operation: "-resize", channel: "G", hex: "8b77cf80fecebac0" },
    { operation: "-thumbnail", channel: "B", hex: "8bad9380fedcc3c0" },
    { operation: "-resize", channel: "B", hex: "8bad9980fedcc0c0" },
    { operation: "-thumbnail", channel: "A", hex: "8badcf50fedcbab0" },
    { operation: "-resize", channel: "A", hex: "8badcf58fedcbaa8" },
    { operation: "-thumbnail", channel: "RGB", hex: "35649380e2d3c3c0" },
    { operation: "-resize", channel: "RGB", hex: "54779980dccec0c0" },
    { operation: "-thumbnail", channel: "RGBA", hex: "35649350e2d3c3b0" },
    { operation: "-resize", channel: "RGBA", hex: "54779958dccec0a8" },
    { operation: "-thumbnail", channel: undefined, hex: "35649350e2d3c3b0" },
    { operation: "-resize", channel: undefined, hex: "54779958dccec0a8" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const append of ["+append", "-append"])
it.each(cases)(`${mode}: ${append} $operation respects channel $channel`, async ({ operation, channel, hex }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:#12345640", "xc:#8badcf80", "xc:#fedcbac0", append,
        ...(channel ? ["-channel", channel] : []), operation, append === "+append" ? "2x1!" : "1x2!",
        "+channel", "-depth", "8", "rgba:-"];
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

// Native filtered red values and copied G/B samples for a 4x3 RGB image.
it.each([
    { operation: "-resize", hex: "227077ff4b9aa1ff9cc4cbffc5eef5ff" },
    { operation: "-thumbnail", hex: "207077ff4a9aa1ff9dc4cbffc7eef5ff" },
])("$operation copies unselected samples through both axes", ({ operation, hex }) => {
    const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
    const result = runMagickCliSync(["/in.ppm", "-channel", "R", operation, "2x2!", "+channel", "-depth", "8", "rgba:-"], new Map([["/in.ppm", input]]));
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(hex);
});
