import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const colors = ["xc:#bcbcbc", "xc:#a0a0a0", "xc:#c0c0c0"];
const metaColors = ["xc:#204080", "xc:#905030", "xc:#7010b0", "xc:#807040", "xc:#40a0b0"];
const separateMeta = ["-channel", "Meta0", "-separate", "+channel"];

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes and inverse-arithmetic/clipping controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { name: "positive working colors", inputs: colors, before: ["multiply", "2"], after: ["divide", "2"], expected: "bca0c0ff" },
    { name: "negative working colors", inputs: colors, before: ["subtract", "90%"], after: ["add", "90%"], expected: "bca0c0ff" },
    { name: "unscaled colors", inputs: colors, expected: "bca0c0ff" },
    { name: "positive output clipping", inputs: colors, before: ["multiply", "2"], expected: "ffffffff" },
    { name: "negative output clipping", inputs: colors, before: ["subtract", "90%"], expected: "000000ff" },
    { name: "unscaled divide control", inputs: colors, after: ["divide", "2"], expected: "5e5060ff" },
    { name: "positive working meta", inputs: metaColors, before: ["multiply", "3"], separate: separateMeta, after: ["divide", "3"], expected: "8d4a" },
    { name: "negative working meta", inputs: metaColors, before: ["subtract", "90%"], separate: separateMeta, after: ["add", "90%"], expected: "8d4a" },
    { name: "unscaled meta divide control", inputs: metaColors, separate: separateMeta, after: ["divide", "3"], expected: "2f19" },
    { name: "positive meta output clipping", inputs: metaColors, before: ["multiply", "3"], separate: separateMeta, expected: "ffff" },
    { name: "negative meta output clipping", inputs: metaColors, before: ["subtract", "90%"], separate: separateMeta, expected: "0000" },
    { name: "mixed samples and extents across chunks", inputs: ["(", "-size", "513x2", colors[0]!, "-evaluate", "multiply", "3", ")", "(", "-size", "1x1", "xc:#505050", ")", "(", "-size", "513x2", colors[2]!, "-evaluate", "multiply", "3", ")"], after: ["divide", "3"], expected: "bc1bc0ff" + "bcbcc0ff".repeat(1025) },
    { name: "working meta across chunks and rows", inputs: ["-size", "513x2", ...metaColors], before: ["multiply", "3"], separate: separateMeta, after: ["divide", "3"], expected: "8d4a".repeat(1026) },
])(`${mode}: $name`, async ({ inputs, before = [], separate = [], after = [], expected }) => {
    const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const argv = [...inputs, ...(before.length ? ["-evaluate", ...before] : []), "-combine", ...separate,
        ...(after.length ? ["-evaluate", ...after] : []), "-depth", separate.length ? "16" : "8", "-endian", "MSB", separate.length ? "gray:/out" : "rgba:/out"];
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
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
