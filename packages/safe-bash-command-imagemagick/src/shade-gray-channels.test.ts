import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, Gray shading followed by conversion to sRGB.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const depth of [8, 16] as const)
for (const [channel, single, nonuniform] of [
    ["R", "a4a4a480", "b2e9b2e9b2e9808073c273c273c2333362b462b462b4cccc"],
    ["G", "59595980", "59795979597980804a564a564a563333868586858685cccc"],
    ["B", "59595980", "59795979597980804a564a564a563333868586858685cccc"],
    ["RGB", "a4a4a480", "b2e9b2e9b2e9808073c273c273c2333362b462b462b4cccc"],
    ["A", "595959a4", "597959795979b2e94a564a564a5673c286858685868562b4"],
    ["Default", "a4a4a4a4", "b2e9b2e9b2e9b2e973c273c273c273c262b462b462b462b4"],
    ["", "a4a4a4a4", "b2e9b2e9b2e9b2e973c273c273c273c262b462b462b462b4"]
] as const)
it(`shades Gray ${channel || "implicit channels"} at depth ${depth} through ${mode}`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["xc:#345caa80", ...(depth === 16 ? ["xc:#d0206033", "xc:#10a0e0cc", "+append"] : []),
        "-colorspace", "Gray", ...(channel ? ["-channel", channel] : []), "-shade", "30x40", "+channel",
        "-format", "%[colorspace] %[channels]", "-write", "info:/space", "-colorspace", "sRGB",
        "-endian", "MSB", "-depth", String(depth), "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    const colorspace = mode === "buffered" || mode === "sync" ? files.get("/space")! : await fs.readFile("/space");
    expect(new TextDecoder().decode(colorspace)).toBe("Gray graya 2.0");
    expect(Buffer.from(output).toString("hex")).toBe(depth === 8 ? single : nonuniform);
});
