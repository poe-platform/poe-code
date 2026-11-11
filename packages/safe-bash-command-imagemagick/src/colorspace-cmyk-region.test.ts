import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with the region cleared before raw export.
for (const mode of ["command", "sync"] as const)
for (const region of ["1x1+0+0", "1x1+1+0", "2x1", "cleared", "none"])
it.each([
    { before: [], space: "CMYK", coder: "cmyka", converted: "0000ead97b8c19194040", protectedPixel: "39f330f0353504b84040" },
    { before: ["-colorspace", "CMYK"], space: "sRGB", coder: "rgba", converted: "e6e6131377774040", protectedPixel: "2b683e8735774040" },
])(`${mode}: convert to $space with ${region} region`, async ({ before, space, coder, converted, protectedPixel }) => {
    const argv = ["-size", "2x1", "xc:#e6137740", ...before,
        ...(region === "none" ? [] : ["-region", region === "cleared" ? "1x1" : region]),
        ...(region === "cleared" ? ["+region"] : []), "-colorspace", space, "+region",
        "-depth", "16", "-endian", "MSB", `${coder}:/out`];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(bytes).toString("hex")).toBe(region === "1x1+0+0" ? converted + protectedPixel
        : region === "1x1+1+0" ? protectedPixel + converted : converted.repeat(2));
});
