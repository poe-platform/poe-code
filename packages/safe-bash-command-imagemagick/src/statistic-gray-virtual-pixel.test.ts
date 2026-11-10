import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact decoded RGBA16 from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    ["gray", "800080008000ffff"],
    ["white", "ffffffffffffffff"],
    ["black", "000000000000ffff"],
])(`${mode}: uses Q16 %s virtual pixels for Maximum`, async (virtualPixel, expected) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out.png", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out.png", keep);
    const args = ["xc:black", "-virtual-pixel", virtualPixel, "-statistic", "Maximum", "3x1", "PNG64:/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([1, 1]);
    expect(output.data16).toBeDefined();
    expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
});
