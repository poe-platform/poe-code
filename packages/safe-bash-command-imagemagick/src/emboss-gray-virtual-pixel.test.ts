import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("50360a3320330a3235350a03142434445464758595a5b5c5d6e6f606162637475767778798a8", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI: in.ppm -colorspace SPACE -background BACKGROUND
// -virtual-pixel METHOD -emboss 1x1 -colorspace sRGB -depth 8 rgb:-.
const cases = [
    { space: "Gray", background: "#40c080", method: "checker-tile", hex: "000000000000333333ffffffffffff000000000000666666999999" },
    { space: "Gray", background: "black", method: "checker-tile", hex: "606060202020404040ffffffffffff808080000000ffffffffffff" },
    { space: "Gray", background: "#40c080", method: "edge", hex: "000000000000000000ffffffffffff000000000000404040ffffff" },
    { space: "Gray", background: "#40c080", method: "horizontal-tile", hex: "000000000000000000ffffffffffff333333000000666666999999" },
    { space: "Gray", background: "#40c080", method: "vertical-tile", hex: "000000000000000000ffffffffffff000000000000ffffffffffff" },
    { space: "Gray", background: "#40c080", method: "background", hex: "000000000000000000ffffffffffff000000000000800080ff0080" },
    { space: "LinearGray", background: "#40c080", method: "checker-tile", hex: "000000000000000000bcbcbcffffff000000000000000000000000" },
];

for (const mode of ["magick", "convert", "buffered", "retained", "sync"] as const)
it.each(cases)(`${mode}: matches native $space emboss with $background $method borders`, async ({ space, background, method, hex }) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const command = mode === "magick" || mode === "convert";
    const args = ["/in.ppm", "-colorspace", space, "-background", background, "-virtual-pixel", method,
        "-emboss", "1x1", "-colorspace", "sRGB", "-depth", "8", command ? "rgb:-" : "rgb:/out.raw"];
    let stdout = "", stderr = "";
    const result = command ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const output = command ? stdout
        : Buffer.from(mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw")).toString("hex");
    expect(output).toBe(hex);
});
