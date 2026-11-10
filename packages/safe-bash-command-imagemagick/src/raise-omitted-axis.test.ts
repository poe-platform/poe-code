import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, cropped top-left RGBA pixels.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const [option, geometries, expected] of [
    ["-raise", ["2x", "2X", "2x0"], "9471c4a09471c4a09471c4a09471c4a0"],
    ["-raise", ["x1", "X1", "0x1"], "b39ad5bcb39ad5bc7040b0807040b080"],
    ["+raise", ["x1", "X1", "0x1"], "3b225d443b225d447040b0807040b080"],
] as const)
it.each(geometries)(`matches native ${option} %s with an omitted or zero bevel axis, ${mode}`, async geometry => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["out", original]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", original);
    const args = ["-size", "8x6", "xc:#7040b080", "-set", "option:band", "2x1", option, geometry,
        "-crop", "2x2+0+0", "-depth", "8", "rgba:out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
