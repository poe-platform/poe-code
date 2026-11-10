import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: black ink is independent of alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["-append", "+append"])
it.each([
    { name: "metadata", inputs: ["-size", "2x1", "xc:#2060b080", "-size", "1x2", "xc:#c04020ed"], output: ["-format", "%[colorspace] %[channels]", "info:/out"], expected: "CMYK cmyka 5.0" },
    { name: "single metadata", inputs: ["-size", "2x1", "xc:#2060b080"], output: ["-format", "%[colorspace] %[channels]", "info:/out"], expected: "CMYK cmyka 5.0" },
    { name: "black", inputs: ["xc:#2060b080", "xc:#c04020ed"], output: ["-channel", "K", "-separate", "-depth", "8", "rgba:/out"], expected: "4f4f4fff3f3f3fff" },
    { name: "single black", inputs: ["xc:#2060b080"], output: ["-channel", "K", "-separate", "-depth", "8", "rgba:/out"], expected: "4f4f4fff" },
    { name: "16-bit black", inputs: ["xc:#0001000200038000", "xc:#000400050006ed00"], output: ["-channel", "K", "-separate", "-depth", "16", "-endian", "MSB", "rgba:/out"], expected: "fffcfffcfffcfffffff9fff9fff9ffff" },
    { name: "cyan", inputs: ["xc:cmyk(25,25,25,10)", "xc:cmyk(60,128,220,201)"], output: ["-channel", "C", "-separate", "-depth", "8", "rgba:/out"], expected: "191919ff3c3c3cff" },
    { name: "original inks", inputs: ["xc:cmyk(25,25,25,10)", "xc:cmyk(60,128,220,201)"], output: ["-channel", "K", "-separate", "-depth", "8", "rgba:/out"], expected: "0a0a0affc9c9c9ff" },
    { name: "padded black", inputs: ["-size", "513x1", "xc:#2060b080", "-size", "1x2", "xc:#c04020ed"], output: ["-channel", "K", "-separate", "-depth", "8", "rgba:/out"], expected: direction === "-append" ? "4f4f4fff".repeat(513) + ("3f3f3fff" + "000000ff".repeat(512)).repeat(2) : "4f4f4fff".repeat(513) + "3f3f3fff" + "000000ff".repeat(513) + "3f3f3fff" },
    { name: "alpha", inputs: ["xc:#2060b080", "xc:#c04020ed"], output: ["-channel", "A", "-separate", "-depth", "8", "rgba:/out"], expected: "808080ffedededff" },
    { name: "all planes", inputs: ["xc:#2060b080", "xc:#c04020ed"], output: ["-separate", "-format", "%wx%h;", "info:/out"], expected: (direction === "-append" ? "1x2;" : "2x1;").repeat(5) },
    { name: "opaque planes", inputs: ["xc:#2060b0", "xc:#c04020"], output: ["-separate", "-format", "%wx%h;", "info:/out"], expected: (direction === "-append" ? "1x2;" : "2x1;").repeat(4) },
])(`${mode} ${direction}: preserves CMYK $name`, async ({ inputs, output, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const previous = new TextEncoder().encode("KEEP");
    await fs.writeFile("/out", previous);
    files.set("/out", previous);
    const argv = [...inputs, "-colorspace", "CMYK", direction, ...output];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(output.at(-1)!.startsWith("info:") ? "utf8" : "hex")).toBe(expected);
});
