import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { method: "background", background: "lime", expected: "00ff00ff00ff00ff" },
    { method: "background", background: "#ff000080", expected: "ff000080ff000080" },
    { method: "edge", background: "lime", expected: "0a141eff5a6e82ff" },
    { method: undefined, background: "lime", expected: "0a141eff5a6e82ff" },
    { method: "transparent", background: "lime", expected: "0000000000000000" },
])(`samples virtual pixels for -convolve (${mode}, $method, $background)`, async ({ method, background, expected }) => {
    // ImageMagick 7.1.2-35 Q16-HDRI: the kernel samples above this one-row image.
    const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-alpha", "set", "-background", background,
        ...(method ? ["-virtual-pixel", method] : []), "-convolve", "0,1,0,0,0,0,0,0,0",
        // Later settings must not change a queued convolution.
        "-background", "blue", "-virtual-pixel", "edge", "-depth", "8", "rgba:-"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
});
