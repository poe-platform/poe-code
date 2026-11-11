import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI reference pixels for synchronized LinearGray thresholding.
const cases = [
    { name: "active alpha", input: "xc:#34465880", args: ["-threshold", "20%"], hex: "ffffffff" },
    { name: "opaque control", input: "xc:#344658", args: ["-threshold", "20%"], hex: "000000ff" },
    { name: "disabled alpha", input: "xc:#34465880", args: ["-alpha", "off", "-threshold", "20%"], hex: "000000ff" },
    { name: "explicit RGB channels", input: "xc:#34465880", args: ["-channel", "RGB", "-threshold", "20%"], hex: "00000080" },
    { name: "luminance intensity", input: "xc:#34465880", args: ["-intensity", "Rec709Luminance", "-threshold", "20%"], hex: "00000000" },
    { name: "linear luminance above cutoff", input: "xc:#34465880", args: ["-intensity", "Rec709Luminance", "-threshold", "5%"], hex: "ffffffff" },
    { name: "opaque single channel intensity", input: "xc:#344658", args: ["-intensity", "MS", "-threshold", "5%"], hex: "ffffffff" },
    { name: "automatic threshold control", input: "xc:#34465880", args: ["-auto-threshold", "Otsu"], hex: "ffffffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: LinearGray $name matches native output`, async ({ input, args, hex }) => {
        const argv = [input, "-colorspace", "LinearGray", ...args, "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        const files = new Map<string, Uint8Array>([["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        let stderr = "";
        const parsed = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: parsed.args, argumentValues: parsed, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}

