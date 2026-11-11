import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: red, muted green, blue.
const input = Uint8Array.from(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex"));
const cases = [
    ...[["R", "000000636363aaaaaa"], ["G", "ffffff929292ffffff"], ["B", "5555554b4b4b555555"]].map(([channel, hex]) => ({
        name: `HSI ${channel} channel`, args: ["/in.ppm", "-colorspace", "HSI", "-channel", channel!, "-separate", "-depth", "8", "rgb:/out"], hex,
    })),
    { name: "HSI round trip", args: ["/in.ppm", "-colorspace", "HSI", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "ff00002080400000ff" },
    { name: "sRGB control", args: ["/in.ppm", "-colorspace", "sRGB", "-channel", "R", "-separate", "-depth", "8", "rgb:/out"], hex: "ffffff202020000000" },
    { name: "implicit HSI output conversion", args: ["/in.ppm", "-colorspace", "HSI", "rgb:/out"], hex: "ff00002080400000ff" },
    { name: "repeated mixed-case HSI with alpha", args: ["xc:#20804080", "-colorspace", "hSi", "-colorspace", "HSI", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "20804080" },
    { name: "HSI black", args: ["xc:black", "-colorspace", "HSI", "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "0 0 0" },
    { name: "HSI gray round trip", args: ["xc:#808080", "-colorspace", "HSI", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "808080" },
    { name: "HSI metadata and pixel", args: ["xc:red", "-colorspace", "HSI", "-format", "%[colorspace]|%[pixel:p{0,0}]", "info:/out"], text: "HSI|hsi(0,100%,33.3333%)" },
    { name: "HSI pixel enumeration", args: ["xc:red", "-colorspace", "HSI", "txt:/out"], contains: "hsi(0,100%,33.3333%)" },
    { name: "HSI histogram", args: ["xc:red", "-colorspace", "HSI", "-format", "%c", "histogram:info:/out"], contains: "hsi(0,100%,33.3333%)" },
    { name: "HSI metadata assignment", args: ["xc:black", "-set", "colorspace", "HSI", "-format", "%[colorspace]", "info:/out"], text: "HSI" },
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const test of cases) it(`matches native ${test.name} (${mode})`, async () => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(test.args, files) : mode === "buffered" ? await runConvertCli(test.args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(test.args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        if ("contains" in test) expect(new TextDecoder().decode(bytes)).toContain(test.contains);
        else expect(Buffer.from(bytes).toString("text" in test ? "utf8" : "hex")).toBe("text" in test ? test.text : test.hex);
    });
}
