import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const option of ["-raise", "+raise"])
for (const channel of ["", "Default", "K", "R"])
it(`shades default CMYK black ink with ${option}, ${channel || "implicit channels"}, ${mode}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "3x3", "xc:#345caa80", "-colorspace", "CMYK",
        ...(channel ? ["-channel", channel] : []), option, "1x1",
        "-channel", "K", "-separate", "-depth", "8", "gray:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    // Native ImageMagick 7.1.2-35 Q16-HDRI: all border regions and the unchanged center.
    expect(Buffer.from(output).toString("hex")).toBe(channel === "R" ? "55".repeat(9)
        : option === "-raise" ? "a5a5a580553f802d3f" : "2d2d2d3f55803fa580");
});
