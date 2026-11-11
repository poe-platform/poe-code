import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8.
const cases = [
    ...["Gray", "LinearGray"].flatMap(space => ["R", "G", "B", "RGB", "A"].map(channel => ({
        space, emboss: true, channel,
        hex: space === "Gray"
            ? channel === "R" || channel === "RGB" ? "00000080ffffffa0808080f0"
                : channel === "A" ? "54545455888888aa929292ff" : "54545480888888a0929292f0"
            : channel === "R" || channel === "RGB" ? "00000080bcbcbca0fffffff0"
                : channel === "A" ? "606060558f8f8faaa6a6a6ff" : "606060808f8f8fa0a6a6a6f0",
    }))),
    { space: "HSL", emboss: false, channel: undefined, hex: "305060ff507080ff908050ff" },
    { space: "HSL", emboss: true, channel: undefined, hex: "000000ffffffffffffffffff" },
    { space: "HSL", emboss: true, channel: "R", hex: "306060ff805050ff905050ff" },
    { space: "Lab", emboss: false, channel: undefined, hex: "305060ff507080ff908050ff" },
    { space: "Lab", emboss: true, channel: undefined, hex: "502600ff00ffffffffe500ff" },
    { space: "Lab", emboss: true, channel: "R", hex: "335263ff86a7b8fffffec8ff" },
    { space: "sRGB", emboss: true, channel: undefined, hex: "005555ff55aaffffffaa00ff" },
];

for (const mode of ["magick", "convert", "buffered", "retained", "sync"] as const)
it.each(cases)(`${mode}: preserves $space emboss=$emboss channel=$channel through sRGB conversion`, async ({ space, emboss, channel, hex }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const gray = space === "Gray" || space === "LinearGray";
    const args = [...(gray ? ["xc:#a2403980", "xc:#4094dfa0", "xc:#15c037f0"] : ["xc:#305060", "xc:#507080", "xc:#908050"]), "+append", "-colorspace", space,
        ...(channel ? ["-channel", channel] : []), ...(emboss ? ["-emboss", gray ? "2x1" : "1x1"] : []),
        "+channel", "-colorspace", "sRGB", "-depth", "8", mode === "magick" || mode === "convert" ? "rgba:-" : "rgba:/out.raw"];
    let stdout = "", stderr = "";
    const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const output = mode === "magick" || mode === "convert" ? stdout
        : Buffer.from(mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw")).toString("hex");
    expect(output).toBe(hex);
});
