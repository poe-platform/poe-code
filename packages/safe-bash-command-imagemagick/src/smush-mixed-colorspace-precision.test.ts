import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA16 output in MSB order.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["+smush", "-smush"])
it.each([
    { space: "RGB", background: "#aabbcc40", rgba: "581b406c4dd0a0801cc7c729fbf47060" },
    { space: "RGB", background: "none", rgba: "12153434565680800000ffffffff4040" },
    { space: "Lab", background: "#aabbcc40", rgba: "581b406c4dd0a080fbce71bf1ab67060" },
])(`${mode} ${direction}: preserves Lab/$space precision over $background`, async ({ space, background, rgba }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [
        "(", "-size", "1x1", "xc:#12345680", "-colorspace", "Lab", ")",
        "(", "-size", "1x1", "xc:#e8742840", "-colorspace", space, ")",
        "-background", background, direction, "0", "-depth", "16", "-endian", "MSB", "rgba:/out"
    ];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(rgba);
});
