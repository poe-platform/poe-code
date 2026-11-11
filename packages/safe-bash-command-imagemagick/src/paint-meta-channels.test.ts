import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: constant RGB selects the last brush pixel,
// so metadata must follow that pixel rather than its own intensity histogram.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { name: "unfiltered", options: [], expected: "2080c0" },
    { name: "default channels", options: ["-paint", "1"], expected: "80c0c0" },
    { name: "explicit Meta0", options: ["-channel", "Meta0", "-paint", "1"], expected: "80c0c0" },
    { name: "red preserves Meta0", options: ["-channel", "R", "-paint", "1"], expected: "2080c0" },
    { name: "reset channels", options: ["-channel", "R", "+channel", "-paint", "1"], expected: "80c0c0" },
    { name: "sixth plane", options: ["-paint", "1"], extraPlane: true, output: "Meta1", expected: "80c0c0" },
    { name: "explicit Meta1", options: ["-channel", "Meta1", "-paint", "1"], extraPlane: true, output: "Meta1", expected: "80c0c0" },
    { name: "Meta0 preserves Meta1", options: ["-channel", "Meta0", "-paint", "1"], extraPlane: true, output: "Meta1", expected: "2080c0" },
    { name: "Meta0 preserves red", options: ["-channel", "Meta0", "-paint", "1"], output: "R", expected: "404040" },
    { name: "16-bit samples", options: ["-paint", "1"], depth: "16", expected: "8180c1c0c1c0" },
    { name: "varying RGB guide", options: ["-paint", "1"], varyingRgb: true, expected: "2020c0" },
    { name: "successive paints", options: ["-paint", "1", "-paint", "1"], expected: "c0c0c0" },
    { name: "white virtual pixels", options: ["-virtual-pixel", "white", "-paint", "1"], expected: "000000" },
    { name: "tiled virtual pixels", options: ["-virtual-pixel", "tile", "-paint", "1"], expected: "80c020" },
])(`${mode}: paint $name`, async ({ options, expected, extraPlane = false, varyingRgb = false, output = "Meta0", depth = "8" }) => {
    const ramp = ["(", "+size", ...(depth === "16"
        ? ["xc:#202120212021", "xc:#808180818081", "xc:#c0c1c0c1c0c1"]
        : ["xc:#202020", "xc:#808080", "xc:#c0c0c0"]), "+append", ")"];
    const argv = [...(varyingRgb ? ramp : []), "-size", "3x1", "xc:#404040", "-duplicate", varyingRgb ? "2" : "3",
        ...ramp, ...(extraPlane ? ramp : []), "-combine", ...options,
        "+channel", "-channel", output, "-separate", "+channel", "-depth", depth, "gray:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const hex = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? Buffer.from(result.stdoutBytes).toString("hex") : stdout;
    expect(hex).toBe(expected);
});
