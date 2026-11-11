import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, with the same PPM bytes and arguments.
const cases = [
    {
        name: "red only", before: ["-channel", "R"], after: [], output: "rgba:-",
        expected: "355ca5ff5a3780ffc9125bffa4ed36ffa4c811ff5aa3ecff5a7ec7ff7c59a2ff7f347dff7f0f58ff7cea33ff5ac50eff57a0e9ff327bc4ff32569fff",
    },
    {
        name: "alpha on an opaque source", before: ["-channel", "A"], after: [], output: "rgba:-",
        expected: "135ca5ffee3780ffc9125bffa4ed36ff7fc811ff5aa3ecff357ec7ff1059a2ffeb347dffc60f58ffa1ea33ff7cc50eff57a0e9ff327bc4ff0d569fff",
    },
    {
        name: "extra plane", before: ["-channel-fx", "red=>meta0", "-channel", "Meta0"],
        after: ["-channel", "Meta0", "-separate"], output: "gray:-",
        expected: "355ac9a4a45a5a7c7f7f7c5a573232",
    },
    {
        name: "default channels", before: [], after: [], output: "rgba:-",
        expected: "355ca5ff5a59a2ffc9377dffa45958ffa4c836ff5aa3a5ff5a7ea2ff7c7b80ff7f597dff7f5658ff7cc533ff5aa3a2ff577ec4ff3259a2ff32569fff",
    },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-median", "3"], ["-statistic", "Median", "3"]])
it.each(cases)(`${mode}: ${operation.join(" ")} honors $name`, async ({ before, after, output, expected }) => {
    const input = Uint8Array.from([...new TextEncoder().encode("P6\n5 3\n255\n"),
        ...Array.from({ length: 45 }, (_, i) => (i * 73 + 19) % 256)]);
    const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const args = ["-quiet", "/in.ppm", ...before, ...operation, ...after, "-depth", "8", output];
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
