import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves RGBA through inverse scaling.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["-append", "+append"])
it.each([
    { name: "over-range", operation: ["Multiply", "3"], inverse: ["Divide", "3"], colors: ["2060b080", "c04020ed"] },
    { name: "fractional", operation: ["Divide", "7"], inverse: ["Multiply", "7"], colors: ["2060b080", "c04020ed"] },
    { name: "single over-range", operation: ["Multiply", "3"], inverse: ["Divide", "3"], colors: ["2060b080"] },
    { name: "single fractional", operation: ["Divide", "7"], inverse: ["Multiply", "7"], colors: ["2060b080"] },
    { name: "unscaled", operation: [], inverse: [], colors: ["2060b080", "c04020ed"] },
])(`${mode} ${direction}: $name`, async ({ operation, inverse, colors }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const previous = new TextEncoder().encode("KEEP");
    await fs.writeFile("/out", previous);
    files.set("/out", previous);
    const argv = [
        ...colors.flatMap(color => ["(", `xc:#${color}`, ...(operation.length ? ["-evaluate", ...operation] : []), ")"]),
        direction, ...(inverse.length ? ["-evaluate", ...inverse] : []), "-depth", "8", "rgba:/out"
    ];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(colors.join(""));
});

for (const mode of ["retained", "buffered", "sync"] as const)
for (const direction of ["-append", "+append"])
it.each([8, 16])(`${mode} ${direction}: copies mixed working and integer samples across chunks at depth %s`, async depth => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [
        "(", "-size", "513x1", "xc:#2060b080", "-evaluate", "Divide", "7", ")",
        "(", "-size", "1x2", depth === 16 ? "xc:#0001000200030004" : "xc:#01020304", ")",
        "-background", "#02030405", "-gravity", "southeast", direction,
        "-evaluate", "Multiply", "7", "-depth", String(depth), "-endian", "MSB", "rgba:/out"
    ];
    const result = mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const first = depth === 16 ? "20206060b0b08080" : "2060b080";
    const second = depth === 16 ? "0007000e0015001c" : "070e151c";
    const padding = depth === 16 ? "0e0e15151c1c2323" : "0e151c23";
    const expected = direction === "-append"
        ? first.repeat(513) + (padding.repeat(512) + second).repeat(2)
        : padding.repeat(513) + second + first.repeat(513) + second;
    const bytes = mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});

// Native ImageMagick Q16-HDRI: fractional colorspace samples survive append.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["-append", "+append"])
for (const space of ["HSL", "Lab"])
for (const clone of [false, true])
for (const width of [1, 513])
for (const info of [false, true])
it(`${mode} ${direction}: preserves fractional ${space} samples (clone=${clone}, width=${width}, info=${info})`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["-size", `${width}x1`, "xc:#b2346680", ...(clone ? [] : ["xc:#34a295c0"]), "-colorspace", space,
        ...(clone ? ["+clone"] : []), direction, ...(info ? ["-format", "%[fx:u.r]|%[fx:u.g]|%[fx:u.b]", "info:/out"]
            : ["-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"])];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const first = space === "HSL" ? "b2b2343466668080" : "b2b5342a66648080";
    const second = clone ? first : space === "HSL" ? "3434a2a29595c0c0" : "3437a2a29594c0c0";
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(info ? "utf8" : "hex")).toBe(info
        ? space === "HSL" ? "0.933862|0.547826|0.45098" : "0.425812|0.713431|0.501191"
        : first.repeat(width) + second.repeat(width));
});
