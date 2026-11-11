import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { kernel: undefined, expected: "1234234534569876abcddef0" },
    { kernel: "0,0,0,0,1,0,0,0,0", expected: "1234234534569876abcddef0" },
    { kernel: "0,0,0,1,1,1,0,0,0", expected: "3ef550c86d346bb57e4aa612" },
])(`preserves 16-bit RGB convolution samples (${mode}, $kernel)`, async ({ kernel, expected }) => {
    // Native ImageMagick 7.1.2-35 Q16-HDRI, exact RGB16 stdout bytes.
    const input = Buffer.from("50360a3220310a36353533350a1234234534569876abcddef0", "hex");
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", ...(kernel ? ["-convolve", kernel] : []), "-depth", "16", "-endian", "MSB", "rgb:-"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
});
