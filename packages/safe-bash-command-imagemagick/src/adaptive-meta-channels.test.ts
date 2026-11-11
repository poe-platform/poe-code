import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: four constant planes and a varying fifth plane.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of ["sharpen", "blur"] as const)
it.each([
    { name: "unfiltered", selection: [], filter: false, output: "Meta0", sharpen: "2080c0", blur: "2080c0" },
    { name: "default channels", selection: [], filter: true, output: "Meta0", sharpen: "0a87cf", blur: "3579b2" },
    { name: "reset channels", selection: ["-channel", "R", "+channel"], filter: true, output: "Meta0", sharpen: "0a87cf", blur: "3579b2" },
    { name: "red preserves Meta0", selection: ["-channel", "R"], filter: true, output: "Meta0", sharpen: "2080c0", blur: "2080c0" },
    { name: "explicit Meta0 uses RGB edge intensity", selection: ["-channel", "Meta0"], filter: true, output: "Meta0", sharpen: "2080c0", blur: "2080c0" },
    { name: "sixth plane", selection: [], extraPlane: true, filter: true, output: "Meta1", sharpen: "0a87cf", blur: "3579b2" },
    { name: "selected Meta0 with bright RGB edges", selection: ["-channel", "Meta0"], color: "#c0c0c0", filter: true, output: "Meta0", sharpen: "0a87cf", blur: "3579b2" },
    { name: "varying RGB guide", selection: [], varyingRgb: true, filter: true, output: "Meta0", sharpen: "2087cf", blur: "2079b2" },
    { name: "explicit selection with varying RGB guide", selection: ["-channel", "R,Meta0"], varyingRgb: true, filter: true, output: "Meta0", sharpen: "2080c0", blur: "2080c0" },
    { name: "16-bit output", selection: [], filter: true, output: "Meta0", depth: 16, sharpen: "310ad08760cf", blur: "b734a37906b3" },
    { name: "zero sigma", selection: [], filter: true, output: "Meta0", geometry: "1x0", sharpen: "2080c0", blur: "2080c0" },
    { name: "Meta0 preserves red", selection: ["-channel", "Meta0"], filter: true, output: "R", sharpen: "404040", blur: "404040" },
])(`${mode}: adaptive ${operation} $name`, async ({ selection, filter, output, depth = 8, geometry = "1x1", color = "#404040", extraPlane = false, varyingRgb = false, ...expected }) => {
    const ramp = ["(", "+size", "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")"];
    const argv = [...(varyingRgb ? ramp : []), "-size", "3x1", `xc:${color}`, "-duplicate", varyingRgb ? "2" : "3", ...ramp, ...(extraPlane ? ramp : []), "-combine", ...selection,
        ...(filter ? [`-adaptive-${operation}`, geometry] : []),
        "-channel", output, "-separate", "+channel", "-depth", String(depth), "gray:-"];
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
    expect(hex).toBe(expected[operation]);
});
