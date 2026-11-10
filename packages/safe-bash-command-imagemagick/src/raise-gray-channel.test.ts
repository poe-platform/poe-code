import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    ["Gray", "R", "-raise", "a4a4a480a4a4a480a4a4a480"],
    ["Gray", "G", "-raise", "525252805252528052525280"],
    ["sRGB", "R", "-raise", "b340b080b340b080b340b080"],
    ["Gray", "R", "+raise", "2c2c2c802c2c2c802c2c2c80"],
    ["Gray", "G", "+raise", "525252805252528052525280"],
])(`matches native %s channel %s %s shading, ${mode}`, async (space, channel, option, expected) => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", original);
    const argv = ["-size", "8x6", "xc:#7040b080", "-colorspace", space, "-channel", channel,
        option, "2x1", "+channel", "-colorspace", "sRGB", "-crop", "3x1+1+0", "-depth", "8", "rgba:out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
    const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
    // Native ImageMagick 7.1.2-35 Q16-HDRI samples, including unchanged alpha.
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
