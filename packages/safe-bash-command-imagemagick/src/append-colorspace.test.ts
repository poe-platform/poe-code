import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI references, including Lab padding.
for (const mode of ["command", "filesystem", "map", "sync"] as const)
for (const direction of ["-append", "+append"])
for (const space of ["RGB", "HSL", "Lab", "sRGB"])
for (const single of [false, true])
it(`${mode}: ${direction} preserves ${space} (${single ? "single" : "multiple"} frames)`, async () => {
    const fs = createMemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const source = ["-size", "2x1", "xc:#2060b080", ...(single ? [] : ["-size", "1x2", "xc:#c04020ed"]), "-colorspace", space, direction];
    for (const info of [true, false]) {
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        files.set("/out", new TextEncoder().encode("KEEP"));
        const args = [...source, ...(info ? ["-format", "%[colorspace] %[channels]", "info:/out"] : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        const padding = space === "Lab" ? "ff5a00ff" : "ffffffff";
        expect(info ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(info
            ? `${space === "Lab" ? "CIELab" : space} ${space === "Lab" ? "cielab" : space.toLowerCase()}a 4.0`
            : single ? "2060b0802060b080" : direction === "-append"
                ? `2060b0802060b080c04020ed${padding}c04020ed${padding}`
                : `2060b0802060b080c04020ed${padding}${padding}c04020ed`);
    }
});
