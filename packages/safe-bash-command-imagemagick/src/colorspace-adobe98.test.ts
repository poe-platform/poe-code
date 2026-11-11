import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI outputs for red, muted green, and blue.
const cases = [
    { args: ["-channel", "R", "-separate"], hex: "dcdcdc4c4c4c000000" },
    { args: ["-channel", "G", "-separate"], hex: "000000808080000000" },
    { args: ["-channel", "B", "-separate"], hex: "000000444444fafafa" },
    { args: ["-colorspace", "sRGB"], hex: "ff00002080400000ff" },
    { args: ["-colorspace", "ADOBE98", "-channel", "R", "-separate"], hex: "dcdcdc4c4c4c000000" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`converts Adobe98 channels (${mode}): $args`, async ({ args: operations, hex }) => {
        const args = ["/in.ppm", "-colorspace", "aDoBe98", ...operations, "-depth", "8", "rgb:/out"];
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}

it.each([
    { args: ["-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "589a8080bea38080" },
    { args: ["-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "40458080c0bf8080" },
    { args: ["-set", "colorspace", "sRGB", "-set", "colorspace", "Adobe98", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "4080c080" },
])("preserves Adobe98 precision and alpha: $args", async ({ args, hex }) => {
    const files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["xc:#4080c080", "-colorspace", "Adobe98", ...args], files);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(files.get("/out")!).toString("hex")).toBe(hex);
});

it("reports Adobe98 working pixels", async () => {
    const result = await runConvertCli(["xc:#4080c080", "-colorspace", "Adobe98", "-format", "%[colorspace] %[pixel:p{0,0}] %[gamma]", "info:"], new Map());
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Adobe98 adobe98a(34.6103%,50.1957%,74.4685%,0.501961) 0.454545");
});


it("writes Adobe98 samples to PNG while preserving alpha", async () => {
    const files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["xc:#4080c080", "-colorspace", "Adobe98", "PNG32:/out"], files);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(decodeImage(files.get("/out")!).data).toString("hex")).toBe("5880be80");
});
