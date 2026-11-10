import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI uses the first frame's channel layout.
const extra = ["(", "xc:#808080", "-duplicate", "3", "xc:white", "-combine", ")"];
const second = ["(", "xc:#404040", "-duplicate", "3", "xc:#202020", "-combine", ")"];
const ordinary = ["xc:#23456789"];
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-layers", "merge"], ["-mosaic"], ["-layers", "mosaic"], ["-flatten"], ["-layers", "flatten"]])
it.each([
    { name: "first frame channel layout", frames: [...extra, ...ordinary], output: ["-format", "%[channels]", "info:/out"], expected: "srgba 5.1", text: true },
    { name: "first frame Meta0 samples", frames: [...extra, ...ordinary], output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "ff" },
    { name: "alpha-blended Meta0", frames: [...extra, ...second], output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "a6" },
    { name: "intervening ordinary frame alpha", frames: [...extra, ...ordinary, ...second], output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "bb" },
    { name: "positioned Meta0", frames: [...extra, "-repage", "2x1+0+0", "(", ...second, "-repage", "2x1+1+0", ")"], output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "ff20" },
    { name: "transparent Meta0", frames: ["(", "xc:none", "-duplicate", "3", "xc:#808080", "-combine", ")"], output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "00" },
    { name: "16-bit Meta0", frames: ["(", "xc:#808080", "-duplicate", "3", "xc:gray(32.33%)", "-combine", ")", ...ordinary], output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], expected: "52c3" },
    { name: "ordinary first frame control", frames: [...ordinary, ...extra], output: ["-format", "%[channels]", "info:/out"], expected: "srgba 4.0", text: true },
])(`${mode} ${operation.join(" ")}: $name`, async ({ frames, output, expected, text }) => {
    const argv = [...frames, "-background", "none", ...operation, ...output];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(text ? "utf8" : "hex")).toBe(expected);
});
