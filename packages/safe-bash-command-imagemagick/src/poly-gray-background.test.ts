import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Gray inputs retain colored virtual pixels in -poly.
for (const mode of ["sync", "map", "retained", "command"] as const)
for (const output of ["rgba:-", "PNG32:-"])
it.each([
    { background: "red", size: "1x1", expected: "2f2f2f80ff0000ff" },
    { background: "lime", size: "1x1", expected: "2f2f2f8000ff00ff" },
    { background: "#77777770", size: "1x1", expected: "2f2f2f8077777770" },
    { background: "red", size: "2x1", expected: "2f2f2f802f2f2f80" },
])(`${mode}, ${output}: Gray polynomial with $background background and $size source`, async ({ background, size, expected }) => {
    const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
    let stderr = "";
    const argv = ["-size", "2x1", "xc:#27548380", "-size", size, "xc:#12345680",
        "-colorspace", "Gray", "-background", background, "-virtual-pixel", "Background",
        "-poly", "0,1,1,1", "-colorspace", "sRGB", "-depth", "8", output];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(output === "rgba:-" ? bytes : decodeImage(bytes).data).toString("hex")).toBe(expected);
});

it("keeps a Gray source's unselected color channel out of every output color channel", () => {
    const result = runMagickCliSync([
        "xc:#27548380", "-colorspace", "Gray",
        "(", "xc:#12345680", "-colorspace", "Gray", "-channel", "Alpha", ")",
        "-poly", "0,1,1,1", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:-",
    ], new Map());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("00000080");
});
