import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI output for the same PPM bytes and arguments.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const [space, channel, expected] of [
    ["HSL", "", "44b6c440b8ae40b09d41bcc15598d14fa2cd"],
    ["Lab", "", "ff7f44ff80539d7b6fbb7d68f0805aff804f"],
    ["CMYK", "K", "00ffffa4ff00ff5effff00339900cc681acc005680700075"],
    ["CMYK", "", "a4a4a4a45e5e5e5e33333333686868685656565675757575"],
    ["HSL", "R", "00e4ff00ffea00ffd2209ba02065a0101b20"],
    ["Lab", "G", "eb4100ffb33200adffc47c2a6e40a04b002d"],
    ["CMYK", "R", "a4ffff005e00ff0033ff00006800cc5f56cc005f757000df"],
    ["sRGB", "", "787878d7d7d7d9d9d9bbbbbbe0e0e0d0d0d0"]
] as const)
it(`shades ${space} ${channel || "all channels"} through ${mode}`, async () => {
    const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff40a0209020a0101220", "hex")]);
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-colorspace", space, ...(channel ? ["-channel", channel] : []),
        "-shade", "30x45", "-format", "%[colorspace]", "-write", "info:/space", "-depth", "8", `${space === "CMYK" ? "cmyk" : "rgb"}:/out`];
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
    expect(new TextDecoder().decode(colorspace)).toBe(space === "Lab" ? "CIELab" : space);
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
