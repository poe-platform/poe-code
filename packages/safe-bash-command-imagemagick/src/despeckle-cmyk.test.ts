import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete -depth 8 rgba:- output.
const cases = [
    { space: "CMYK", selection: ["-channel", "K"], rgba: "3a4b7080" },
    { space: "CMYK", selection: ["-channel", "R"], rgba: "38406080" },
    { space: "CMYK", selection: [], rgba: "41527070" },
    { space: "CMYK", selection: ["-channel", "A"], rgba: "32406070" },
    { space: "sRGB", selection: ["-channel", "R"], rgba: "22406080" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(cases)(`despeckles native $space channels $selection (${mode})`, async ({ space, selection, rgba }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const tokens = ["xc:#32406080", "-colorspace", space, ...selection, "-despeckle", "+channel",
        "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
    let stderr = "";
    const arguments_ = createCommandArguments(tokens);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(tokens, files)
        : await runConvertCli(tokens, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(rgba);
});
