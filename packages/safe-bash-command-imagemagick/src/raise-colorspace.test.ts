import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels after conversion back to sRGB.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const [size, crop, interior] of [["8x6", "3x1+1+0", false], ["520x6", "3x1+511+0", false], ["8x6", "3x1+2+2", true]] as const)
for (const [space, bevel, channel, pixel] of [
    ["HSL", "-raise", "", "eb84dabc"],
    ["Lab", "-raise", "", "ff486fbc"],
    ["HSL", "-raise", "R", "b0409d80"],
    ["sRGB", "-raise", "", "b39ad5bc"],
    ["Lab", "+raise", "", "0095dc44"],
    ["HSL", "", "", "7040b080"]
] as const)
it(`shades ${space} working samples: ${bevel}, ${channel || "default channels"}, ${size} ${crop}, ${mode}`, async () => {
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const args = ["-size", size, "xc:#7040b080", "-colorspace", space,
        ...(channel ? ["-channel", channel] : []), ...(bevel ? [bevel, "2x1"] : []),
        "+channel", "-colorspace", "sRGB", "-crop", crop, "-depth", "8", "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe((interior ? "7040b080" : pixel).repeat(3));
});
