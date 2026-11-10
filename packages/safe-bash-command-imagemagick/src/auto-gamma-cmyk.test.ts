import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA output from the same three-pixel PAM.
const cases = [
    { name: "separated black", space: "CMYK", channels: ["-channel", "K"], output: ["-channel", "K", "-separate"], expected: "555555ff858585ffa2a2a2ff" },
    { name: "black", space: "CMYK", channels: ["-channel", "K"], output: ["-colorspace", "sRGB"], expected: "3971aa205f1b7a601b505d40" },
    { name: "cyan", space: "CMYK", channels: ["-channel", "R"], output: ["-colorspace", "sRGB"], expected: "4580c0207520906023607040" },
    { name: "default", space: "CMYK", channels: [], output: ["-colorspace", "sRGB"], expected: "204893473e0f668c0e354c6d" },
    { name: "sRGB red control", space: "sRGB", channels: ["-channel", "R"], output: ["-colorspace", "sRGB"], expected: "7a80c020a520906054607040" },
    { name: "alpha", space: "CMYK", channels: ["-channel", "A"], output: ["-colorspace", "sRGB"], expected: "4080c05a7020909c20607080" },
    {"name": "opaque default", "space": "CMYK", "channels": ["-alpha", "off"], "output": ["-colorspace", "sRGB"], "depth": "8", "expected": "234d98ff42106aff10394fff"},
    {"name": "cyan black and alpha", "space": "CMYK", "channels": ["-channel", "CKA"], "output": ["-colorspace", "sRGB"], "depth": "8", "expected": "3d71aa5a631b7a9c1d505d80"},
    {"name": "black region", "space": "CMYK", "channels": ["-channel", "K", "-region", "1x1+1+0"], "output": ["+region", "-colorspace", "sRGB"], "depth": "8", "expected": "54a7fb205f1b7a6041c2e240"},
    {"name": "default region", "space": "CMYK", "channels": ["-region", "1x1+1+0"], "output": ["+region", "-colorspace", "sRGB"], "depth": "8", "expected": "e7edf7203e0f668cadcad640"},
    {"name": "16-bit black", "space": "CMYK", "channels": ["-channel", "K"], "output": ["-colorspace", "sRGB"], "depth": "16", "expected": "38ee71dbaac920205f9f1b527af160601abe503a5d994040"},
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: matches native CMYK auto-gamma for $name`, async ({ space, channels, output, depth = "8", expected }) => {
        const input = Buffer.concat([
            Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            Buffer.from("4080c0207020906020607040", "hex"),
        ]);
        const files = new Map([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", input);
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const args = ["/in.pam", "-colorspace", space, ...channels, "-auto-gamma", "+channel", ...output, "-depth", depth, "-endian", "MSB", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(actual).toString("hex")).toBe(expected);
    });
}
