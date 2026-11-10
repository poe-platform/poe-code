import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI results, including an explicit sRGB conversion.
for (const mode of ["buffered", "sync", "retained", "command"] as const)
for (const [colorspace, rgba] of [["HSL", "05090e0f"], ["Lab", "73818f91"], ["RGB", "4080c0cc"], ["sRGB", "4080c0cc"]])
for (const output of ["info", "rgba"] as const)
it(`${mode}: combine ${colorspace} planes produces sRGB ${output}`, async () => {
    const fs = new MemoryFileSystem();
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", original]]);
    await fs.writeFile("/out", original);
    const argv = ["xc:#404040", "xc:#808080", "xc:#c0c0c0", "xc:#cccccc",
        "-colorspace", colorspace!, "-combine",
        ...(output === "info" ? ["-format", "%[colorspace] %[channels]", "info:/out"]
            : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(output === "info" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex"))
        .toBe(output === "info" ? "sRGB srgba 4.0" : rgba);
});
