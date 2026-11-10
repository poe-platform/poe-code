import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const)
for (const method of ["scale2x", "scale3x"] as const)
it.each(["add", "subtract"])(`${mode}: ${method} preserves samples after %s of the quantum range`, async operation => {
    const factor = method === "scale3x" ? 3 : 2;
    const args = ["xc:#204080c0", "xc:#a0403060", "+append", "-evaluate", operation, "100%",
        "-define", `magnify:method=${method}`, "-magnify", "-evaluate", operation === "add" ? "subtract" : "add", "100%",
        "-depth", "8", "rgba:/out"];
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, fs, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
    expect(result.exitCode, stderr).toBe(0);
    // ImageMagick Q16-HDRI repeats each source pixel in a factor-by-factor block.
    expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("/out")!).toString("hex"))
        .toBe(("204080c0".repeat(factor) + "a0403060".repeat(factor)).repeat(factor));
});

it.each(["fish2x", "hq2x", "epbx2x", "eagle2x", "eagle3x", "xbr2x"])("%s retains out-of-range samples through blending", method => {
    const files = new Map<string, Uint8Array>();
    const result = runConvertCliSync(["xc:#204080c0", "-evaluate", "add", "100%",
        "-define", `magnify:method=${method}`, "-magnify", "-evaluate", "subtract", "100%",
        "-depth", "8", "rgba:/out"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Buffer.from(files.get("/out")!).toString("hex")).toBe("204080c0".repeat(method === "eagle3x" ? 9 : 4));
});
