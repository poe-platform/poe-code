import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

async function run(args: string[]) {
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
    });
    expect(result.exitCode, stderr).toBe(0);
    return { fs, stdout };
}

// ImageMagick 7.1.2-35 Q16-HDRI reference results.
it("retains YIQ samples through unique-colors and conversion back to sRGB", async () => {
    const { fs } = await run(["xc:red", "xc:blue", "xc:red", "+append", "-colorspace", "YIQ", "-unique-colors", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"]);
    expect([...await fs.readFile("/out")]).toEqual([0, 0, 255, 255, 0, 0]);
});

it("reports YIQ metadata and preserves alpha on a round trip", async () => {
    const { stdout } = await run(["xc:#ff000080", "-colorspace", "yIq", "-format", "%[colorspace]|%[channels]", "info:"]);
    const { fs } = await run(["xc:#ff000080", "-colorspace", "YIQ", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"]);
    expect(stdout).toBe("YIQ|yiqa 4.0");
    expect([...await fs.readFile("/out")]).toEqual([255, 0, 0, 128]);
});

it.each([["R", 0x4c], ["G", 0xff], ["B", 0xb5]] as const)("exports the native YIQ %s component", async (channel, expected) => {
    const { fs } = await run(["xc:#ff000080", "-colorspace", "YIQ", "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:/out"]);
    expect([...await fs.readFile("/out")]).toEqual([expected]);
});


it.each(["info:", "txt:-", "histogram:info:-"])("retains unclamped YIQ components in %s output", async output => {
    const args = ["xc:red", "-colorspace", "YIQ", "-format", "%[pixel:p{0,0}]", ...(output === "histogram:info:-" ? ["-format", "%c"] : []), output];
    const command = await run(args);
    const buffered = await runMagickCli(args, new Map<string, Uint8Array>());
    const sync = runMagickCliSync(args, new Map<string, Uint8Array>());
    for (const result of [buffered, sync]) expect(result.exitCode, result.stderr).toBe(0);
    for (const result of [command, buffered, sync]) expect(result.stdout).toContain("yiq(76.2039,279.408,181.421)");
});
