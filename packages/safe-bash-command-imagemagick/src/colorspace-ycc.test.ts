import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference output.
const components = ["-format", "%[colorspace] %[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"];
const rgb = ["-depth", "16", "-endian", "MSB", "rgb:/out"];
const rgba = [...rgb.slice(0, -1), "rgba:/out"];
const cases = [
    { name: "red YCC components", color: "red", args: ["-colorspace", "YCC", ...components], text: "YCC 0.328424 0.283341 1" },
    { name: "blue YCC components", args: ["-colorspace", "YCC", ...components], text: "YCC 0.449387 1 0.0878681" },
    { name: "YCC inverse", args: ["-colorspace", "YCC", "-colorspace", "sRGB", ...rgb], hex: "0000a27dffff" },
    { name: "mixed-case repeated YCC and alpha", color: "#0080ff80", args: ["-colorspace", "yCc", "-colorspace", "YCC", "-colorspace", "sRGB", ...rgba], hex: "0000a27dffff8080" },
    { name: "implicit YCC PNG conversion", color: "#0080ff80", args: ["-colorspace", "YCC", "PNG64:/out"], pixels: "0000a27dffff8080" },
    { name: "YCC black", color: "black", args: ["-colorspace", "YCC", ...components], text: "YCC 0 0.611765 0.537255" },
    { name: "YCC white", color: "white", args: ["-colorspace", "YCC", ...components], text: "YCC 1 0.612149 0.537078" },
    { name: "YCC dark curve", color: "#010305", args: ["-colorspace", "YCC", ...components], text: "YCC 0.00260937 0.630767 0.534735" },
    { name: "YCC dark inverse", color: "#010305", args: ["-colorspace", "YCC", "-colorspace", "sRGB", ...rgb], hex: "0000000008ab" },
    { name: "YCC pixel format", color: "red", args: ["-colorspace", "YCC", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "ycc(83.748,72.252,255)" },
    { name: "YCC text output", color: "red", args: ["-colorspace", "YCC", "txt:/out"], contains: "ycc(83.748,72.252,255)" },
    { name: "YCC histogram", color: "red", args: ["-colorspace", "YCC", "-format", "%c", "histogram:info:/out"], contains: "ycc(83.748,72.252,255)" },
    { name: "declared YCC", color: "#4080c080", args: ["-set", "colorspace", "YCC", "-colorspace", "sRGB", ...rgba], hex: "8a83239912728080" },
    { name: "YCC clips above-white input", color: "white", args: ["-evaluate", "Multiply", "2", "-colorspace", "YCC", ...components], text: "YCC 1 0.612149 0.537078" },
    { name: "YCC clips negative input", color: "black", args: ["-evaluate", "Subtract", "50%", "-colorspace", "YCC", ...components], text: "YCC 0 0.611765 0.537255" },
    { name: "YCC via linear RGB", args: ["-colorspace", "YCC", "-colorspace", "RGB", "-colorspace", "sRGB", ...rgb], hex: "0000a27dffff" },
    { name: "YCbCr red control", color: "red", args: ["-colorspace", "YCbCr", ...components], text: "YCbCr 0.298839 0.331263 1" },
    { name: "YCbCr inverse control", args: ["-colorspace", "YCbCr", "-colorspace", "sRGB", ...rgb], hex: "00118091ffff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const test of cases) it(`matches native ${test.name} (${mode})`, async () => {
        const args = [`xc:${"color" in test ? test.color : "#0080ff"}`, ...test.args];
        if ("text" in test) args[args.length - 1] = "info:";
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        let stderr = "", stdout = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" }) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = (mode === "command" || mode === "retained") ? await fs.readFile("/out") : files.get("/out")!;
        if ("text" in test) expect("stdout" in result ? result.stdout : stdout).toBe(test.text);
        else if ("contains" in test) expect(new TextDecoder().decode(bytes)).toContain(test.contains);
        else if ("pixels" in test) expect(Array.from(decodeImage(bytes).data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(test.pixels);
        else expect(Buffer.from(bytes).toString("hex")).toBe(test.hex);
    });
}

for (const [operation, digest] of [
    ["-colorspace", "a565fb3084d41a44c6c298fded9639b01e89ccfc9ad0a12391724d73c7b51dcb"],
    ["-set", "93552f6b53739fdff22dc5fc0c7a3729275f7998d863dd8c46033bd141819432"],
] as const) it(`matches native Q16 YCC boundary grid (${operation})`, () => {
    const levels = [0, 1, 1179, 1180, 32767, 32768, 65534, 65535];
    const input = Uint8Array.from(levels.flatMap(r => levels.flatMap(g => levels.flatMap(b =>
        [r, g, b].flatMap(value => [value >> 8, value & 255])))));
    const files = new Map([["/in", input]]);
    const result = runConvertCliSync(["-size", "512x1", "-depth", "16", "-endian", "MSB", "rgb:/in",
        operation, ...(operation === "-set" ? ["colorspace"] : []), "YCC", "-colorspace", "sRGB",
        ...rgb], files);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(createHash("sha256").update(files.get("/out")!).digest("hex")).toBe(digest);
});
