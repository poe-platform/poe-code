import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference channel metadata and RGBA8 samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of ["-smush", "+smush"])
it.each([
    { name: "deactivated alpha over blue", alpha: ["-alpha", "deactivate"], background: "blue", info: "srgba 4.0|1", rgba: "0818afff" },
    { name: "deactivated alpha over transparent", alpha: ["-alpha", "deactivate"], background: "none", info: "srgba 4.0|0.470588", rgba: "12345678" },
    { name: "active alpha over blue", alpha: [], background: "blue", info: "srgba 4.0|1", rgba: "0818afff" },
])(`${mode} ${operation}: $name`, async ({ alpha, background, info, rgba }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["xc:#12345678", ...alpha, "-background", background, operation, "0",
        "-depth", "8", "-write", "rgba:out.rgba", "-format", "%[channels]|%[fx:a]", "info:out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "", stdout = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    const metadata = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
    const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("out.rgba")!;
    expect(new TextDecoder().decode(metadata)).toBe(info);
    expect(Buffer.from(pixels).toString("hex")).toBe(rgba);
});
