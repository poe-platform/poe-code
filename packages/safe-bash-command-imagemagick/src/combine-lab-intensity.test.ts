import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const [width, height] of [[1, 1], [513, 2]] as const)
it.each([
    { name: "Lab combine", inputs: ["xc:black", "(", "xc:#ff2030", "-colorspace", "Lab", ")", "xc:black", "-combine"], format: "rgb", hex: "0000bdd60000" },
    { name: "sRGB combine control", inputs: ["xc:black", "(", "xc:#ff2030", "-colorspace", "sRGB", ")", "xc:black", "-combine"], format: "rgb", hex: "000050e40000" },
    { name: "Lab grayscale control", inputs: ["xc:#ff2030", "-colorspace", "Lab", "-grayscale", "Rec709Luma"], format: "gray", hex: "bdd6" },
    { name: "Lab meta channel", inputs: ["xc:black", "xc:black", "xc:black", "xc:black", "(", "xc:#ff2030", "-colorspace", "Lab", ")", "-combine", "-channel", "Meta0", "-separate", "+channel"], format: "gray", hex: "bdd6" },
])(`${mode}: retains 16-bit intensity for $name (${width}x${height})`, async ({ inputs, format, hex }) => {
    const files = new Map([["/out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const argv = ["-size", `${width}x${height}`, ...inputs, "-depth", "16", "-endian", "MSB", `${format}:/out`];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex.repeat(width * height));
});
