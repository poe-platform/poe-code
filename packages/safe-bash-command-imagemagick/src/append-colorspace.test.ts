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

// Native ImageMagick copies channel values and uses sRGB for mixed working spaces.
for (const mode of ["command", "filesystem", "map", "sync"] as const)
for (const direction of ["-append", "+append"])
it.each([
    { first: "Lab", second: "sRGB", color: "69b34780", other: "30905040", padding: "ffffffff", space: "sRGB srgba" },
    { first: "HSL", second: "sRGB", color: "bf818080", other: "30905040", padding: "ffffffff", space: "sRGB srgba" },
    { first: "RGB", second: "sRGB", color: "370d8680", other: "30905040", padding: "ffffffff", space: "sRGB srgba" },
    { first: "Lab", second: "Lab", color: "8040c080", other: "30905040", padding: "ff5a00ff", space: "CIELab cielaba" },
    { first: "sRGB", second: "Lab", color: "8040c080", other: "87559a40", padding: "ffffffff", space: "sRGB srgba" },
])(`${mode}: ${direction} $first followed by $second`, async ({ first, second, color, other, padding, space }) => {
    const fs = createMemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const source = [
        "(", "-size", "2x3", "xc:#8040c080", "-colorspace", first, ")",
        "(", "-size", "3x2", "xc:#30905040", "-colorspace", second, ")", direction
    ];
    for (const info of [true, false]) {
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        files.set("/out", new TextEncoder().encode("KEEP"));
        const args = [...source, ...(info ? ["-format", "%wx%h %g %[colorspace] %[channels];", "info:/out"] : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(info ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(info
            ? `${direction === "-append" ? "3x5" : "5x3"} 2x3+0+0 ${space} 4.0;`
            : direction === "-append" ? (color.repeat(2) + padding).repeat(3) + other.repeat(6)
                : (color.repeat(2) + other.repeat(3)).repeat(2) + color.repeat(2) + padding.repeat(3));
    }
});
