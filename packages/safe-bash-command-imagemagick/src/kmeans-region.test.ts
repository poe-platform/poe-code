import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA stdout including protected pixels.
for (const mode of ["public", "map"])
it.each([
    [true, "1x1+1+0", "1", "021c0080015501aa001c0280"],
    [true, "1x1+1+0", "1x1", "7d1c1c80555555aa1c1c7d80"],
    [true, "1x1+1+0", "1x2", "5e1c1580405540aa151c5e80"],
    [true, "1x1+1+0", "1x3", "461c1080305530aa101c4680"],
    [true, "3x1+0+0", "1", "555555aa555555aa555555aa"],
    [false, "1x1+1+0", "1", "ff0000ff555555ff0000ffff"],
    [true, "", "1", "555555aa555555aa555555aa"],
    [true, "1x1+1+0", "1x0", "ff00008000ff00ff0000ff80"],
    [true, "1x1+9+0", "1", "021c008000ff00ff001c0280"],
    [true, "1x1+1+0", "2", "0200018000ff00ff01000280"],
    [true, "1x1+1+0", "1", "01bd1c6300658080013055550130ab0000651c6301bd8080", "16"],
    [true, "1x1+1+0", "1x2", "5e011c6315598080402a5555402aab0015591c635e018080", "16"],
])(`matches native k-means region blending (alpha=%s, region=%s, geometry=%s, mode=${mode})`, async (alpha, region, geometry, expected, depth = "8") => {
    const argv = ["-seed", "42", `xc:#ff0000${alpha ? "80" : "ff"}`, "xc:#00ff00ff", `xc:#0000ff${alpha ? "80" : "ff"}`, "+append",
        ...(region ? ["-region", region] : []), "-kmeans", geometry, "+region", "-depth", depth, "-endian", "MSB"];
    if (mode === "public") {
        const args = createCommandArguments([...argv, "rgba:-"]), stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
        });
        expect(result.exitCode).toBe(0);
        expect(Buffer.concat(stderr).toString()).toBe("");
        expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
    } else {
        const files = new Map<string, Uint8Array>();
        const result = await runMagickCli([...argv, "rgba:out"], files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(Buffer.from(files.get("out")!).toString("hex")).toBe(expected);
    }
});
