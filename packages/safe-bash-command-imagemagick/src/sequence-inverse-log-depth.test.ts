import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA reference bytes.
for (const mode of ["command", "retained", "map", "sync"] as const)
for (const depth of [8, 16])
for (const unequal of [false, true])
it.each([
    { colors: ["#014589", "#490321"], rgba16: "000500000000ffff", rgba8: "000000ff" },
    { colors: ["#014589", "#490321", "#965403"], rgba16: "198affffffffffff", rgba8: "19ffffff" },
    { colors: ["#014589"], rgba16: "010145458989ffff", rgba8: "014589ff" },
])(`${mode}: retains InverseLog precision at depth ${depth}, unequal sizes ${unequal}, $colors`, async ({ colors, rgba16, rgba8 }) => {
    const inputs = colors.flatMap((color, index) => ["-size", unequal && index > 0 ? "2x1" : "1x1", `xc:${color}`]);
    const argv = [...inputs, "-evaluate-sequence", "InverseLog", "-depth", String(depth), "-endian", "MSB", "rgba:-"];
    const args = createCommandArguments(argv), fs = new MemoryFileSystem();
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const files = new Map<string, Uint8Array>();
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(chunk) { stdout.push(chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(mode === "command" ? Buffer.concat(stderr).toString() : result.stderr).toBe("");
    const output = mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(output.toString("hex")).toBe((depth === 16 ? rgba16 : rgba8).repeat(unequal && colors.length > 1 ? 2 : 1));
});
