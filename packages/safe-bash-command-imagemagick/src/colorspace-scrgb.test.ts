import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: red, muted green, blue.
const input = Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex");

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { space: "scRGB", operation: ["-channel", "R", "-separate"], expected: "ffffff040404000000" },
    { space: "scRGB", operation: ["-channel", "G", "-separate"], expected: "000000373737000000" },
    { space: "scRGB", operation: ["-channel", "B", "-separate"], expected: "0000000d0d0dffffff" },
    { space: "scRGB", operation: ["-colorspace", "sRGB"], expected: "ff00002080400000ff" },
    { space: "ScRgB", operation: ["-colorspace", "RGB", "-colorspace", "scRGB"], expected: "ff000004370d0000ff" },
])(`${mode}: converts $space with $operation`, async ({ space, operation, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", "-colorspace", space, ...operation, "-depth", "8", "rgb:/out.raw"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
