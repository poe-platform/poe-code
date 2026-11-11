import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 8-bit input gains working precision before reduction.
for (const mode of ["command", "retained", "map", "sync"] as const)
it.each([
    { operation: "ThresholdBlack", edit: ["Add", "3%"], expected: "11b81bc225cc6208761c8a30" },
    { operation: "Max", edit: ["Add", "3%"], expected: "11b81bc225cc6208761c8a30" },
    { operation: "ThresholdWhite", edit: ["Multiply", "0.47"], expected: "04b809700e282a7733e73d57" },
    { operation: "Min", edit: ["Multiply", "0.47"], expected: "04b809700e282a7733e73d57" },
])(`${mode}: $operation retains selected working samples after $edit`, async ({ operation, edit, expected }) => {
    const input = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
    const files = new Map([["/in.ppm", input]]), fs = createMemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "(", "+clone", "-evaluate", ...edit, ")", "-evaluate-sequence", operation,
        "-depth", "16", "-endian", "MSB", "rgb:-"];
    const stdout: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(data) { stdout.push(data); } },
        stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(output.toString("hex")).toBe(expected);
});
