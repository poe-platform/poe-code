import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete raw destination bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) it.each([
    { space: "CMYK", method: "white", offset: 4, black: false, hex: "458abcff458abcff458abcff000000ff" },
    { space: "CMYK", method: "background", offset: 4, black: false, hex: "458abcff458abcff458abcffdb9753ff" },
    { space: "CMYK", method: "background", offset: 4, black: true, hex: "4343434343430000" },
    { space: "CMYK", method: "edge", offset: 4, black: false, hex: "458abcff458abcff458abcff458abcff" },
    { space: "CMYK", method: "background", offset: 1, black: false, hex: "458abcff042369ff458abcff458abcff" },
    { space: "sRGB", method: "white", offset: 4, black: false, hex: "458abcff458abcff458abcffffffffff" },
])(`${mode}: splice $space $method offset $offset black=$black matches native`, async ({ space, method, offset, black, hex }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
    const argv = [
        "-size", "3x1", "xc:#458abc", "-colorspace", space, "-background", "#2468ac",
        "-virtual-pixel", method, "-splice", `1x0+${offset}+0`,
        ...(black ? ["-channel", "K", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"]
            : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"]),
    ];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
