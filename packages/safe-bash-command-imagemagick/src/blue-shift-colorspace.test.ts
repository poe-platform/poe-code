import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including untouched round trips.
const cases = [
    ["HSL", false, "4080a080"],
    ["HSL", true, "9979e680"],
    ["Lab", false, "4080a080"],
    ["Lab", true, "ee836480"],
    ["sRGB", true, "a0b0b880"],
] as const;

for (const mode of ["buffered", "sync", "retained", "command"] as const)
it.each(cases)(`${mode}: preserves %s blue-shift=%s through conversion to sRGB`, async (space, shift, expected) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const argv = ["xc:#4080a080", "-colorspace", space,
        ...(shift ? ["-blue-shift", "1.5"] : []),
        "-colorspace", "sRGB", "-depth", "8", "rgba:/out.rgba"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const output = mode === "buffered" || mode === "sync" ? files.get("/out.rgba")! : await fs.readFile("/out.rgba");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
