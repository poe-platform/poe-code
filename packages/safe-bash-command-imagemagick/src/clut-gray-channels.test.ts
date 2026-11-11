import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: only two Gray inputs retain one color channel.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const sourceGray of [false, true])
for (const lookupGray of [false, true])
it.each([
    { operation: [], gray: "555555ff", rgb: "555555ff" },
    { operation: ["-channel", "R", "-negate", "+channel"], gray: "aaaaaaff", rgb: "aa5555ff" },
    { operation: ["-channel", "B", "-evaluate", "set", "100%", "+channel"], gray: "555555ff", rgb: "5555ffff" },
    { operation: ["-format", "%[colorspace]:%[channels]"], gray: "Gray:gray  1.0", rgb: "sRGB:srgb  3.0" },
])(`${mode}: sourceGray=${sourceGray}, lookupGray=${lookupGray}, $operation`, async ({ operation, gray, rgb }) => {
    const info = operation[0] === "-format";
    const argv = ["xc:#777777", ...(sourceGray ? ["-colorspace", "Gray"] : []),
        "(", "xc:#555555", ...(lookupGray ? ["-colorspace", "Gray"] : []), ")", "-clut", ...operation,
        ...(info ? ["info:"] : ["-depth", "8", `rgba:${mode === "command" ? "-" : "/out"}`])];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(info ? "utf8" : "hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? stdout : info && "stdout" in result ? result.stdout
        : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
    expect(output).toBe(sourceGray && lookupGray ? gray : rgb);
});
