import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex"));

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs, including clipped chroma.
it.each([
    ["R", "4c4c4c5c5c5c1d1d1d"],
    ["G", "0d0d0d555555ffffff"],
    ["B", "000000f2f2f2b7b7b7"],
    [undefined, "ff00002080400000ff"],
])("converts YDbDr through all execution paths: %s", async (channel, expected) => {
    const args = ["/in.ppm", "-colorspace", "YDbDr", ...(channel ? ["-channel", channel, "-separate"] : ["-colorspace", "sRGB"]), "-depth", "8", "rgb:/out.raw"];
    for (const run of [runConvertCli, runMagickCliSync]) {
        const files = new Map([["/in.ppm", input]]);
        const result = await run(args, files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(Buffer.from(files.get("/out.raw")!).toString("hex")).toBe(expected);
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(Buffer.from(await fs.readFile("/out.raw")).toString("hex")).toBe(expected);
});

it("recognizes mixed case and preserves alpha through YDbDr", async () => {
    const files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["xc:#ff000080", "-colorspace", "yDbDr", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect([...files.get("/out")!]).toEqual([255, 0, 0, 128]);
});

it.each(["info:", "txt:-", "histogram:-"])("preserves unclamped YDbDr samples in %s", async output => {
    const result = await runConvertCli(["xc:red", "-colorspace", "YDbDr", "-format", "%[pixel:p{0,0}]", output], new Map<string, Uint8Array>());
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("ydbdr(76.2039,12.75,-212.415)");
});
