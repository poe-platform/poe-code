import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI: Gray uses one intensity plane plus optional alpha.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const [count, alpha, info, rgba] of [
    [1, "off", "Gray|gray  1.0", "3e3e3eff"],
    [1, "on", "Gray|graya 2.0", "3e3e3eff"],
    [2, "on", "Gray|graya 2.0", "3e3e3e5b"],
    [2, "off", "sRGB|srgb  3.0", "3e5b3eff"],
    [3, "on", "sRGB|srgba 4.0", "3e5b2fff"]
] as const)
for (const output of ["info", "rgba", "alpha"] as const)
it(`${mode}: combines ${count} Gray planes with alpha ${alpha} into ${output}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map([["/out", Buffer.from("KEEP")]]);
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const args = [...["xc:#204080", "xc:#905030", "xc:#123456"].slice(0, count),
        "-colorspace", "Gray", "-alpha", alpha, "-combine",
        ...(output === "info" ? ["-format", "%[colorspace]|%[channels]", "info:/out"]
            : output === "alpha" ? ["-channel", "A", "-separate", "+channel", "-depth", "8", "gray:/out"]
                : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex"))
        .toBe(output === "info" ? info : output === "alpha" ? alpha === "off" ? "00" : rgba.slice(6) : rgba);
});
